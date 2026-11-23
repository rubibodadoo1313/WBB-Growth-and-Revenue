"""Import the G&R monthly dashboards into the JSON the website reads.

Reads every "Outreach Log" sheet from the exported workbooks and writes
normalised data to site/data/. Everything else in those workbooks is
formulas over that one sheet, so the log is the only thing worth importing.

Only the "Outreach Log" sheet is ever read. The "Links" sheet in some
workbooks holds account credentials and personal details; it is deliberately
never touched, so none of it can reach the website or the repository.

Usage:
    python tools/import_sheets.py <folder-with-the-zip-exports> [site/data]
"""

import sys
import os
import re
import json
import glob
import zipfile
import datetime
import tempfile
import collections

from openpyxl import load_workbook

# ---------------------------------------------------------------- normalising

# Canonical platforms. The KPI doc rolls Indeed/BossJob/Glassdoor up into
# "External" for target purposes, but they are kept distinct here so the
# analytics can compare them - the rollup is done in the UI, not on import.
PLATFORM_MAP = {
    "olj": "OLJ",
    "onlinejobs": "OLJ",
    "onlinejobs.ph": "OLJ",
    "linkedin": "LinkedIn",
    "linked in": "LinkedIn",
    "indeed": "Indeed",
    "glassdoor": "Glassdoor",
    "glassdoorglassdoor": "Glassdoor",
    "bossjob": "BossJob",
    "bossjobs": "BossJob",
    "external": "External",
    "ai lead": "AI Lead",
    "ai leads": "AI Lead",
    "referral": "Referral",
    "other": "Other",
}

EXTERNAL_ROLLUP = {"Indeed", "Glassdoor", "BossJob", "External", "Other"}

STATUS_MAP = {
    "sent": "Sent",
    "sents": "Sent",
    "pending": "Pending",
    "replied": "Replied",
    "no response": "No Response",
    "nurture": "Nurture",
    "warm lead": "Warm Lead",
    "scheduled dc": "Scheduled DC",
    "1st follow up": "1st Follow Up",
    "2nd follow up": "2nd Follow Up",
    "3rd follow up": "3rd Follow Up",
    "closed": "Closed",
    "lost": "Lost",
    "expired": "Lost",
}

FUNNEL = ["Sent", "Pending", "Replied", "Warm Lead", "Scheduled DC", "Closed"]
DEAD = {"Lost", "No Response"}
FOLLOW_UPS = {"1st Follow Up", "2nd Follow Up", "3rd Follow Up"}

MONTHS = {
    "JANUARY": 1, "FEBRUARY": 2, "MARCH": 3, "APRIL": 4, "MAY": 5, "JUNE": 6,
    "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9, "OCTOBER": 10, "NOVEMBER": 11,
    "DECEMBER": 12,
}

# Junk that appears in data rows because header rows were copied down.
JUNK = {"", ".", "-", "status", "platform", "date", "n/a", "na", "none"}


def clean(value):
    """Trim a cell to a string, or None if it is empty or junk."""
    if value is None:
        return None
    text = str(value).replace(" ", " ").strip()
    if not text or text.lower() in JUNK:
        return None
    return re.sub(r"\s+", " ", text)


def norm_platform(value):
    text = clean(value)
    if text is None:
        return None, None
    canonical = PLATFORM_MAP.get(text.lower().strip())
    if canonical is None:
        # Unrecognised but non-empty: keep it, flagged, rather than dropping
        # work someone actually did.
        return text, text
    return canonical, None


def norm_status(value):
    text = clean(value)
    if text is None:
        return None, None
    canonical = STATUS_MAP.get(text.lower().strip())
    if canonical is None:
        return None, text
    return canonical, None


def month_from_name(name):
    upper = name.upper()
    for label, number in MONTHS.items():
        if label in upper:
            return number
    return None


def year_from_name(name):
    match = re.search(r"20\d{2}", name)
    return int(match.group()) if match else None


def to_date(value):
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    text = clean(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m/%d/%y", "%B %d, %Y"):
        try:
            return datetime.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------- source files

def contractor_from(path):
    """Pull the contractor code (AB/HFC/KPK/MAP/DCA/PNL) out of a path."""
    match = re.search(r"WBB[ _]+([A-Z]{2,4})[ _]+Sales", path)
    if match:
        return match.group(1)
    match = re.search(r"G&R\s*20\d{2}\s+([A-Z]{2,4})\s+Sales", path)
    if match:
        return match.group(1)
    for part in reversed(path.replace("\\", "/").split("/")):
        if re.fullmatch(r"[A-Z]{2,4}", part):
            return part
    return None


def gather_workbooks(source):
    """Return (path, contractor_code, label) for every workbook we can reach.

    Archives are expanded into a temp directory so the originals are left
    exactly as they are.
    """
    found = []
    tmp = tempfile.mkdtemp(prefix="gr-import-")

    for archive in glob.glob(os.path.join(source, "*.zip")):
        code = contractor_from(os.path.basename(archive))
        target = os.path.join(tmp, code or os.path.basename(archive))
        os.makedirs(target, exist_ok=True)
        try:
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(target)
        except zipfile.BadZipFile:
            print("  ! could not read archive:", os.path.basename(archive))

    for root in (source, tmp):
        for path in glob.glob(os.path.join(root, "**", "*.xlsx"), recursive=True):
            if os.path.basename(path).startswith("~$"):
                continue
            found.append((path, contractor_from(path), os.path.basename(path)))

    # Deduplicate by (contractor, filename) - the extracted copy wins.
    unique = {}
    for path, code, label in found:
        unique[(code, label)] = (path, code, label)
    return sorted(unique.values(), key=lambda item: (item[1] or "", item[2]))


# ---------------------------------------------------------------- the import

def read_log(path, code, label, issues):
    """Yield normalised rows from one workbook's Outreach Log."""
    try:
        wb = load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:                      # noqa: BLE001
        issues["unreadable"].append(f"{label}: {exc}")
        return

    if "Outreach Log" not in wb.sheetnames:
        wb.close()
        return

    fallback_month = month_from_name(label)
    fallback_year = year_from_name(label) or 2026

    ws = wb["Outreach Log"]
    for row in ws.iter_rows(min_row=3, max_col=11, values_only=True):
        cells = (list(row) + [None] * 11)[:11]
        raw_date, name, email, company, platform, role, link, status, notes, _week, follow = cells

        if not any(clean(c) for c in (raw_date, platform, status, role, company)):
            continue

        date = to_date(raw_date)
        inferred = False
        if date is None:
            inferred = True
            if fallback_month:
                date = datetime.date(fallback_year, fallback_month, 1)
            issues["undated"] += 1

        plat, bad_plat = norm_platform(platform)
        if bad_plat:
            issues["platforms"][bad_plat] += 1
        stat, bad_stat = norm_status(status)
        if bad_stat:
            issues["statuses"][bad_stat] += 1

        if date is None:
            issues["dropped_no_date"] += 1
            continue

        follow_date = to_date(follow)
        yield {
            "c": code,
            "d": date.isoformat(),
            "inf": 1 if inferred else 0,
            "p": plat,
            "s": stat,
            "co": clean(company),
            "r": clean(role),
            "e": clean(email),
            "n": clean(name),
            "l": clean(link),
            "nt": clean(notes),
            "fu": follow_date.isoformat() if follow_date else None,
        }

    wb.close()


def week_of_month(date):
    return min(((date.day - 1) // 7) + 1, 5)


def build(source, outdir):
    print("reading from:", source)
    workbooks = gather_workbooks(source)
    print(f"workbooks found: {len(workbooks)}")

    issues = {
        "undated": 0,
        "dropped_no_date": 0,
        "platforms": collections.Counter(),
        "statuses": collections.Counter(),
        "unreadable": [],
    }

    by_contractor = collections.defaultdict(list)
    seen = set()
    duplicates = 0

    for path, code, label in workbooks:
        if not code:
            continue
        count = 0
        for row in read_log(path, code, label, issues):
            # A prospect logged twice on the same day for the same role is a
            # duplicate, not two touches. The sheets had no guard against this.
            key = (row["c"], row["d"], (row["r"] or "").lower(),
                   (row["co"] or "").lower(), (row["l"] or "").lower())
            if key in seen and row["r"]:
                duplicates += 1
                continue
            seen.add(key)
            by_contractor[code].append(row)
            count += 1
        print(f"  {code:<4} {label[:46]:<46} {count:>5}")

    os.makedirs(outdir, exist_ok=True)

    totals = {}
    for code, rows in by_contractor.items():
        rows.sort(key=lambda r: r["d"], reverse=True)
        totals[code] = len(rows)
        path = os.path.join(outdir, f"outreach-{code}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, separators=(",", ":"))
        size = os.path.getsize(path) / 1024 / 1024
        print(f"wrote {os.path.basename(path)}  {len(rows)} rows  {size:.2f} MB")

    all_rows = [r for rows in by_contractor.values() for r in rows]

    facts = collections.Counter()
    daily = collections.Counter()
    weekly = collections.Counter()
    roles = collections.defaultdict(lambda: {"n": 0, "rep": 0, "won": 0})
    companies = collections.Counter()

    for r in all_rows:
        month = r["d"][:7]
        plat = r["p"] or "Unspecified"
        stat = r["s"] or "Unspecified"
        facts[(month, r["c"], plat, stat)] += 1
        if not r["inf"]:
            daily[(r["d"], r["c"])] += 1
        date = datetime.date.fromisoformat(r["d"])
        weekly[(month, week_of_month(date), r["c"])] += 1
        if r["r"]:
            entry = roles[r["r"][:70]]
            entry["n"] += 1
            if stat in ("Replied", "Warm Lead", "Scheduled DC", "Closed"):
                entry["rep"] += 1
            if stat == "Closed":
                entry["won"] += 1
        if r["co"]:
            companies[r["co"][:60]] += 1

    top_roles = sorted(roles.items(), key=lambda kv: -kv[1]["n"])[:200]
    dates = sorted(r["d"] for r in all_rows)

    summary = {
        "meta": {
            "generated": datetime.datetime.now().isoformat(timespec="seconds"),
            "rows": len(all_rows),
            "contractors": totals,
            "first": dates[0] if dates else None,
            "last": dates[-1] if dates else None,
            "workbooks": len(workbooks),
        },
        "platform_rollup": sorted(EXTERNAL_ROLLUP),
        "funnel_order": FUNNEL,
        "dead_statuses": sorted(DEAD),
        "follow_up_statuses": sorted(FOLLOW_UPS),
        "facts": [
            {"m": m, "c": c, "p": p, "s": s, "n": n}
            for (m, c, p, s), n in sorted(facts.items())
        ],
        "daily": [{"d": d, "c": c, "n": n} for (d, c), n in sorted(daily.items())],
        "weekly": [
            {"m": m, "w": w, "c": c, "n": n}
            for (m, w, c), n in sorted(weekly.items())
        ],
        "roles": [
            {"r": role, "n": v["n"], "rep": v["rep"], "won": v["won"]}
            for role, v in top_roles
        ],
        "top_companies": [{"co": co, "n": n} for co, n in companies.most_common(60)],
    }

    with open(os.path.join(outdir, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, separators=(",", ":"))

    quality = {
        "generated": summary["meta"]["generated"],
        "rows_imported": len(all_rows),
        "rows_with_inferred_date": sum(r["inf"] for r in all_rows),
        "rows_dropped_no_date": issues["dropped_no_date"],
        "duplicates_removed": duplicates,
        "unrecognised_platforms": dict(issues["platforms"]),
        "unrecognised_statuses": dict(issues["statuses"]),
        "unreadable_files": issues["unreadable"],
        "missing_company": sum(1 for r in all_rows if not r["co"]),
        "missing_email": sum(1 for r in all_rows if not r["e"]),
        "missing_status": sum(1 for r in all_rows if not r["s"]),
    }
    with open(os.path.join(outdir, "quality.json"), "w", encoding="utf-8") as fh:
        json.dump(quality, fh, indent=1)

    print("\n--- summary ---")
    print("rows imported      ", len(all_rows))
    print("duplicates removed ", duplicates)
    print("inferred dates     ", quality["rows_with_inferred_date"])
    print("dropped (no date)  ", issues["dropped_no_date"])
    print("missing status     ", quality["missing_status"])
    print("date range         ", summary["meta"]["first"], "->", summary["meta"]["last"])
    if issues["platforms"]:
        print("odd platforms      ", dict(issues["platforms"]))
    if issues["statuses"]:
        print("odd statuses       ", dict(issues["statuses"]))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "data")
    build(src, dst)
