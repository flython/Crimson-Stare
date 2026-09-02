#!/usr/bin/env python3
"""
PNG → JPG 压缩脚本
用途: assets/cards/ 下所有 PNG 转 JPG (quality 90, optimize 保留卡图信息)
用法: python scripts/png-to-jpg.py [--quality 90] [--dry-run]
"""
import sys
import os
import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow")
    sys.exit(1)


def convert_png_to_jpg(png_path: Path, quality: int = 90, dry_run: bool = False) -> tuple[bool, str]:
    """单文件转换，返回 (success, message)"""
    jpg_path = png_path.with_suffix(".jpg")
    if jpg_path.exists():
        return False, f"SKIP: {jpg_path.name} already exists"

    if dry_run:
        return True, f"DRY: would convert {png_path.name} → {jpg_path.name}"

    try:
        img = Image.open(png_path)
        # 保留 RGBA 转 RGB（部分卡图有透明通道）
        if img.mode in ("RGBA", "LA", "P"):
            rgb_img = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            rgb_img.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
            rgb_img.save(jpg_path, "JPEG", quality=quality, optimize=True)
        else:
            img.convert("RGB").save(jpg_path, "JPEG", quality=quality, optimize=True)
        return True, f"OK: {png_path.name} → {jpg_path.name} ({os.path.getsize(jpg_path) // 1024}KB)"
    except Exception as e:
        return False, f"ERROR: {png_path.name}: {e}"


def main():
    parser = argparse.ArgumentParser(description="Convert PNG cards to JPG")
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality 1-100 (default 90)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be converted")
    parser.add_argument("--dir", type=str, default="assets/cards", help="Card assets directory")
    args = parser.parse_args()

    assets_dir = Path(args.dir)
    if not assets_dir.exists():
        print(f"ERROR: Directory not found: {assets_dir}")
        sys.exit(1)

    png_files = sorted(assets_dir.rglob("*.png"))
    if not png_files:
        print("No PNG files found in assets/cards/")
        print(f"NOTE: Run 'python scripts/png-to-jpg.py --dry-run' to verify, or")
        print(f"      'python scripts/replace-xlsx-png-refs.py' to fix xlsx references.")
        sys.exit(0)

    print(f"Found {len(png_files)} PNG file(s) in {assets_dir}")
    print(f"Quality: {args.quality}, Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("-" * 60)

    results = {"ok": 0, "skip": 0, "error": 0}
    for png_path in png_files:
        ok, msg = convert_png_to_jpg(png_path, quality=args.quality, dry_run=args.dry_run)
        print(msg)
        if "OK" in msg or "DRY" in msg:
            results["ok"] += 1
        elif "SKIP" in msg:
            results["skip"] += 1
        else:
            results["error"] += 1

    print("-" * 60)
    print(f"Done: {results['ok']} converted, {results['skip']} skipped, {results['error']} error(s)")

    # 如果有转换，更新 xlsx 中的引用
    if results["ok"] > 0 and not args.dry_run:
        print("\nRunning xlsx reference updater...")
        xlsx_script = Path("scripts/replace-xlsx-png-refs.py")
        if xlsx_script.exists():
            os.system(f"{sys.executable} {xlsx_script}")
        else:
            print(f"NOTE: Run 'python scripts/replace-xlsx-png-refs.py' to update xlsx references")


if __name__ == "__main__":
    main()
