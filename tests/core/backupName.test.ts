import { describe, expect, it } from "vitest";
import {
  autoBackupFileName,
  backupFileName,
  expiredAutoBackups,
  rollbackFileName,
} from "../../src/core/backup/backupName";

describe("バックアップのファイル名", () => {
  it("日付と時刻から既定名を作る", () => {
    expect(backupFileName(new Date(2026, 7, 21, 9, 5))).toBe(
      "積算データ_20260821_0905.db",
    );
  });

  it("復元前の退避名は接頭辞が付く", () => {
    expect(rollbackFileName(new Date(2026, 11, 3, 18, 30))).toBe(
      "復元前_積算データ_20261203_1830.db",
    );
  });

  it("自動の控えは1日1つの名前になる", () => {
    expect(autoBackupFileName(new Date(2026, 7, 21, 9, 5))).toBe(
      "自動_20260821.db",
    );
  });

  it("古い自動の控えだけを消す対象にする", () => {
    const names = [
      "自動_20260819.db",
      "自動_20260820.db",
      "自動_20260821.db",
      "積算データ_20260821_0905.db",
    ];
    expect(expiredAutoBackups(names, 2)).toEqual(["自動_20260819.db"]);
    expect(expiredAutoBackups(names, 10)).toEqual([]);
  });
});
