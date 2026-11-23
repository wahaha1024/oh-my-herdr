# tests/test_install.py — Oh My Herdr 安装器端到端测试。
# 只依赖 Python 3 标准库：本文件负责搭出伪安装包（stub 包），分别驱动
# install.ps1（Windows）与 install.sh（Unix），并直接验证清单/备份/恢复行为。
# 运行：python -m pytest tests/test_install.py -v   （或 python tests/test_install.py）

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
IS_WINDOWS = os.name == "nt"
INSTALL_PS1 = REPO / "install.ps1"
INSTALL_SH = REPO / "install.sh"


def run_script(args, cwd):
    """跨平台执行安装器：Windows 用 powershell.exe，其他用 sh。"""
    if IS_WINDOWS:
        cmd = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(INSTALL_PS1),
        ] + args
    else:
        cmd = ["sh", str(INSTALL_SH)] + args
    return subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=120,
    )


class InstallerTest(unittest.TestCase):
    """每个用例生成独立的 stub 包目录与独立的目标配置目录。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="omh-install-test-"))
        self.pkg = self.tmp / "pkg"
        self.target = self.tmp / "target"
        self.pkg.mkdir()
        self.target.mkdir()
        self._make_stub_package()
        (self.target / "settings.json").write_text("{}", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---------- stub 包 ----------

    def _make_stub_package(self):
        """搭出最小可安装的包结构：VERSION + programs.json + layouts/themes/mods/pixel-icons。"""
        (self.pkg / "VERSION").write_text("0.2.0\n", encoding="utf-8")
        programs = {
            "omp": {"icon": "pixel-icons/codex.svg", "tint": False},
            "codebuddy": {
                "name": "CodeBuddy", "icon": "icons/agent.svg", "tint": True,
                "tile": "#1c1d21", "color": "#d6d8db", "run": ["codebuddy"],
                "match": ["codebuddy-code", "cbc"],
            },
        }
        (self.pkg / "programs.json").write_text(
            json.dumps({"programs": programs}, ensure_ascii=False),
            encoding="utf-8",
        )
        for dirname, files in {
            "layouts": ["oh-my-herdr.json", "oh-my-herdr.png"],
            "themes": ["qingci.json", "xuanmo.json", "zhi.json"],
            "pixel-icons": ["codex.svg"],
        }.items():
            base = self.pkg / dirname
            base.mkdir()
            for name in files:
                (base / name).write_text("stub %s/%s\n" % (dirname, name), encoding="utf-8")
        # 两个 mod，其中 inkstone-chrome 含嵌套子目录；gpui-kit.d.ts/jsconfig.json 不应安装。
        for mod, files in {
            "cockpit": ["main.js", "gpui-kit.d.ts", "jsconfig.json"],
            "inkstone-chrome": ["main.js", os.path.join("assets", "icon.svg")],
        }.items():
            base = self.pkg / "mods" / mod
            base.mkdir(parents=True)
            for name in files:
                p = base / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("stub mod %s/%s\n" % (mod, name), encoding="utf-8")

    # ---------- 结果读取辅助 ----------

    def manifest(self):
        return json.loads(
            (self.target / ".omh" / "install.json").read_text(encoding="utf-8"))

    def backup_ids(self):
        d = self.target / ".omh" / "backups"
        if not d.is_dir():
            return []
        return sorted(p.name for p in d.iterdir())

    def backup_file(self, bid, rel):
        return self.target / ".omh" / "backups" / bid / "files" / rel

    def write_target_programs(self, obj):
        (self.target / "programs.json").write_text(
            json.dumps(obj, ensure_ascii=False), encoding="utf-8")

    def read_target_programs(self):
        return json.loads(
            (self.target / "programs.json").read_text(encoding="utf-8"))

    def prog_keys(self):
        return sorted(self.read_target_programs()["programs"].keys())

    def file_count(self):
        n = 0
        for _, _, names in os.walk(self.target):
            n += len(names)
        return n

    def install_args(self, extra=None):
        """按平台拼装指向 self.target 的安装器参数（可附加选项）。"""
        if IS_WINDOWS:
            base = ["-Target", str(self.target)]
            opts = {"force": ["-Force"], "dry": ["-DryRun"],
                    "uninstall": ["-Uninstall"]}
            restore = "-Restore"
        else:
            base = ["--target", str(self.target)]
            opts = {"force": ["--force"], "dry": ["--dry-run"],
                    "uninstall": ["--uninstall"]}
            restore = "--restore"
        args = list(base)
        for key in (extra or []):
            if key == "restore":
                args += [restore, self.backup_ids()[-1]]
            else:
                args += opts[key]
        return args

    # ---------- 用例 ----------

    def test_01_first_install_writes_all_and_manifest(self):
        r = run_script(self.install_args(), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertTrue((self.target / "layouts" / "oh-my-herdr.json").is_file())
        self.assertTrue((self.target / "mods" / "cockpit" / "main.js").is_file())
        self.assertTrue(
            (self.target / "mods" / "inkstone-chrome" / "assets" / "icon.svg").is_file())
        self.assertFalse((self.target / "mods" / "cockpit" / "gpui-kit.d.ts").exists())
        self.assertFalse((self.target / "mods" / "cockpit" / "jsconfig.json").exists())
        self.assertEqual(self.prog_keys(), ["codebuddy", "omp"])
        m = self.manifest()
        self.assertEqual(m.get("version"), "0.2.0")
        self.assertIn("layouts/oh-my-herdr.json", m["files"])
        self.assertTrue(self.backup_ids(), "首次安装应有备份目录")

    def test_02_dry_run_writes_nothing(self):
        r = run_script(self.install_args(["dry"]), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertEqual(self.file_count(), 1)  # 仅 settings.json
        self.assertFalse((self.target / ".omh").exists())

    def test_03_repeat_install_is_idempotent(self):
        run_script(self.install_args(), self.tmp)
        before_count = self.file_count()
        before_manifest = self.manifest()
        r = run_script(self.install_args(), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertEqual(self.file_count(), before_count)
        self.assertEqual(self.manifest(), before_manifest)
        self.assertEqual(self.prog_keys(), ["codebuddy", "omp"])

    def test_04_broken_target_json_preflight_aborts_untouched(self):
        run_script(self.install_args(), self.tmp)
        (self.target / "programs.json").write_text("{broken", encoding="utf-8")
        before = self.file_count()
        for extra in ([], ["dry"]):
            r = run_script(self.install_args(extra), self.tmp)
            self.assertNotEqual(r.returncode, 0, "坏 JSON 必须让安装器失败")
            self.assertEqual(self.file_count(), before, "预检失败后目标不得有任何变化")

    def test_05_force_backup_and_restore_roundtrip(self):
        run_script(self.install_args(), self.tmp)
        layout = self.target / "layouts" / "oh-my-herdr.json"
        layout.write_text("user v1\n", encoding="utf-8")
        # Force 覆盖前必须先备份用户版本。
        r = run_script(self.install_args(["force"]), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        bid = self.backup_ids()[-1]
        self.assertIn("user v1", self.backup_file(bid, "layouts/oh-my-herdr.json")
                      .read_text(encoding="utf-8"))
        self.assertNotIn("user v1", layout.read_text(encoding="utf-8"))
        # 恢复到覆盖前的用户版本。
        r = run_script(self.install_args(["restore"]), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn("user v1", layout.read_text(encoding="utf-8"))

    def test_06_uninstall_keeps_user_modified_and_restores_preexisting(self):
        # 安装前就存在的文件应被登记为 previous 并在卸载时恢复。
        (self.target / "themes" / "qingci.json").write_text("pre-existing\n", encoding="utf-8")
        r = run_script(self.install_args(["force"]), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        # 用户改了另一个文件再卸载：改过的保留、没改的删除/恢复。
        (self.target / "mods" / "cockpit" / "main.js").write_text("user edit\n", encoding="utf-8")
        r = run_script(self.install_args(["uninstall"]), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn("pre-existing",
                      (self.target / "themes" / "qingci.json").read_text(encoding="utf-8"))
        self.assertIn("user edit",
                      (self.target / "mods" / "cockpit" / "main.js").read_text(encoding="utf-8"))
        self.assertFalse((self.target / "layouts" / "oh-my-herdr.json").exists())
        self.assertFalse((self.target / ".omh" / "install.json").exists())

    def test_07_restore_does_not_clobber_later_user_edits(self):
        run_script(self.install_args(), self.tmp)
        theme = self.target / "themes" / "zhi.json"
        # 安装后用户改了文件；恢复不得覆盖这个更新过的内容。
        theme.write_text("user edit v2\n", encoding="utf-8")
        r = run_script(self.install_args(["restore"]), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn("user edit v2", theme.read_text(encoding="utf-8"))

    def test_08_non_default_target_dir(self):
        alt = self.tmp / "alt-home" / ".config" / "herdr-app"
        alt.mkdir(parents=True)
        (alt / "settings.json").write_text("{}", encoding="utf-8")
        saved = self.target
        self.target = alt
        try:
            r = run_script(self.install_args(), self.tmp)
            self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
            self.assertTrue((alt / "layouts" / "oh-my-herdr.json").is_file())
            self.assertEqual(self.prog_keys(), ["codebuddy", "omp"])
        finally:
            self.target = saved

    def test_09_uninstall_then_reinstall_clean(self):
        run_script(self.install_args(), self.tmp)
        run_script(self.install_args(["uninstall"]), self.tmp)
        self.assertFalse((self.target / ".omh" / "install.json").exists())
        # 卸载后重装必须完整可用。
        r = run_script(self.install_args(), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertEqual(self.prog_keys(), ["codebuddy", "omp"])

    def test_10_programs_never_overwrites_existing_keys(self):
        self.write_target_programs({
            "programs": {"omp": {"icon": "user-icon.svg"}},
            "extra": True,
        })
        r = run_script(self.install_args(), self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        doc = self.read_target_programs()
        self.assertEqual(doc["programs"]["omp"], {"icon": "user-icon.svg"})
        self.assertEqual(doc["programs"]["codebuddy"]["name"], "CodeBuddy")
        self.assertEqual(doc.get("extra"), True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
