#!/usr/bin/env python3
"""诊断报告不得传播错误载荷中的路径、会话文字或凭据。"""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import diagnose


class DiagnosticPrivacy(unittest.TestCase):
    def status(self, payload, code=0):
        result = subprocess.CompletedProcess([], code, payload, "private stderr")
        with patch.object(diagnose.shutil, "which", return_value="herdr-app"), patch.object(diagnose.subprocess, "run", return_value=result):
            return diagnose.app_status_errors()

    def test_errors_only_expose_fixed_categories_and_shipped_mods(self):
        errors = [
            {"type": "load", "mod": "inkstone-files", "message": "secret conversation /private/project"},
            {"type": "load", "mod": "inkstone-files", "message": "token=PRIVATE"},
            {"type": "/private/path token=PRIVATE", "mod": "private-customer", "message": "confidential"},
            {"type": ["PRIVATE"], "mod": {"secret": "PRIVATE"}, "message": "TypeError: PRIVATE"},
        ]
        report = self.status(json.dumps({"errors": errors}))
        self.assertEqual(report, ["other-error x1", "type-error x1", "load-error (inkstone-files) x2"])

    def test_unavailable_status_is_not_reported_as_clean(self):
        for payload in ("not JSON secret", "[]", '{}', '{"errors":"private"}'):
            with self.subTest(payload=payload):
                self.assertEqual(self.status(payload), ["status: unavailable"])
        self.assertEqual(self.status('{"errors":[]}', 1), ["status: unavailable"])

    def test_command_errors_do_not_leak_exception_text(self):
        with patch.object(diagnose.shutil, "which", return_value="herdr-app"), patch.object(diagnose.subprocess, "run", side_effect=OSError("secret credential")):
            self.assertEqual(diagnose.app_status_errors(), ["status: unavailable"])

    def test_version_output_discards_non_version_payload(self):
        result = subprocess.CompletedProcess([], 0, "tool 1.2.3 token=PRIVATE /private/path\nsecret", "")
        with patch.object(diagnose.shutil, "which", return_value="tool"), patch.object(diagnose.subprocess, "run", return_value=result):
            self.assertEqual(diagnose.run_version(["tool", "--version"]), "1.2.3")


class LayoutDiagnostic(unittest.TestCase):
    def setUp(self):
        self.tmp = __import__("tempfile").TemporaryDirectory(prefix="omh-layout-diag-")
        self.home = Path(self.tmp.name)
        self.layout = self.home / ".config" / "herdr-app" / "layouts" / "oh-my-herdr.json"
        self.layout.parent.mkdir(parents=True)
        self.doc = {
            "id": "layout", "type": "column", "titlebar": "none",
            "traffic_lights": [12, 16],
            "children": [{"id": "root", "type": "row", "children": []}],
        }

    def tearDown(self):
        self.tmp.cleanup()

    def check(self):
        self.layout.write_text(json.dumps(self.doc), encoding="utf-8")
        with patch.object(diagnose.Path, "home", return_value=self.home):
            return diagnose.layout_structure_errors()

    def test_valid_layout_reports_no_findings(self):
        self.assertEqual(self.check(), [])

    def test_detects_nested_chrome_extra_root_and_pinned_overlay(self):
        self.doc.pop("titlebar")
        self.doc.pop("traffic_lights")
        self.doc["children"][0]["titlebar"] = "none"
        self.doc["children"].append({"id": "space", "type": "block", "content": {"mod": "inkstone-space"}})
        result = self.check()
        self.assertIn("layout: titlebar-not-top-level-none", result)
        self.assertIn("layout: traffic-lights-not-top-level-pair", result)
        self.assertIn("layout: unexpected-root-children", result)
        self.assertIn("layout: overlay-mod-pinned-as-block", result)

    def test_malformed_file_is_unavailable_not_clean(self):
        self.layout.write_text("not json", encoding="utf-8")
        with patch.object(diagnose.Path, "home", return_value=self.home):
            result = diagnose.layout_structure_errors()
        self.assertEqual(result, ["layout: unavailable"])
        self.assertNotIn("not json", str(result))


class FontRegistrationDiagnostic(unittest.TestCase):
    def test_relative_user_font_registration_is_reported_without_names(self):
        entries = [
            ("Private Face (TrueType)", "private-face.ttf"),
            ("Other (TrueType)", "C:\\Fonts\\other.ttf"),
            ("sdk_init_timestamp", "1785762217"),
        ]
        result = diagnose.font_registry_problems(entries, exists=lambda _p: True)
        self.assertEqual(result, ["fonts: relative-registry-path x1"])
        self.assertNotIn("private-face", " ".join(result))

    def test_missing_registered_file_is_reported(self):
        entries = [("Private Face (TrueType)", "C:\\Fonts\\private.ttf")]
        self.assertEqual(
            diagnose.font_registry_problems(entries, exists=lambda _p: False),
            ["fonts: registered-file-missing x1"])

    def test_fully_registered_fonts_report_nothing(self):
        entries = [("Face (TrueType)", "C:\\Fonts\\ok.ttf")]
        self.assertEqual(diagnose.font_registry_problems(entries, exists=lambda _p: True), [])

    def test_non_windows_skips_registry_lookup(self):
        with patch.object(diagnose.platform, "system", return_value="Linux"):
            self.assertEqual(diagnose.font_registry_errors(), [])


if __name__ == "__main__":
    unittest.main()
