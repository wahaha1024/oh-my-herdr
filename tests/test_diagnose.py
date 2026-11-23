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


if __name__ == "__main__":
    unittest.main()
