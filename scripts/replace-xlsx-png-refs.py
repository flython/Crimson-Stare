#!/usr/bin/env python3
"""
将 card-pool-template.xlsx 中所有 .png 图片文件名替换为 .jpg
（仅修改图片文件名列，保留其他内容不变）
"""
import sys
import os
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("ERROR: openpyxl not installed. Run: pip install openpyxl")
    sys.exit(1)


def update_xlsx_png_refs(xlsx_path: str = "config/card-pool-template.xlsx") -> dict:
    """
    扫描所有 sheet 的所有单元格，将 .png 替换为 .jpg
    返回修改统计
    """
    wb = openpyxl.load_workbook(xlsx_path)
    stats = {"sheets_changed": 0, "cells_updated": 0, "details": []}

    for ws in wb.worksheets:
        sheet_changes = []
        for row in ws.iter_rows():
            for cell in row:
                if cell.value and isinstance(cell.value, str) and ".png" in cell.value:
                    old_val = cell.value
                    new_val = cell.value.replace(".png", ".jpg")
                    cell.value = new_val
                    sheet_changes.append(f"  {cell.coordinate}: {old_val} → {new_val}")
                    stats["cells_updated"] += 1

        if sheet_changes:
            stats["sheets_changed"] += 1
            stats["details"].append(f"Sheet '{ws.title}':")
            stats["details"].extend(sheet_changes)

    wb.save(xlsx_path)
    wb.close()
    return stats


def main():
    xlsx_path = "config/card-pool-template.xlsx"
    if not os.path.exists(xlsx_path):
        xlsx_path = Path(__file__).parent.parent / "config" / "card-pool-template.xlsx"
        if not os.path.exists(xlsx_path):
            print(f"ERROR: {xlsx_path} not found")
            sys.exit(1)

    print(f"Processing: {xlsx_path}")
    stats = update_xlsx_png_refs(xlsx_path)

    if stats["cells_updated"] == 0:
        print("No .png references found - nothing to do.")
    else:
        print(f"Updated {stats['cells_updated']} cell(s) in {stats['sheets_changed']} sheet(s):")
        for line in stats["details"]:
            print(line)

    return stats


if __name__ == "__main__":
    main()
