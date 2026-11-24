#!/usr/bin/env python3
"""Regression tests for shipped layout structure invariants."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check


class LayoutStructureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="omh-layout-check-")
        self.root = Path(self.tmp.name)
        self.files = [
            "layouts/oh-my-herdr.json",
            "mods/inkstone-chrome/mod.json",
            "mods/inkstone-space/mod.json",
            "themes/qingci.json",
            "themes/xuanmo.json",
        ]
        self.layout = {
            "id": "layout-root",
            "type": "column",
            "titlebar": "none",
            "traffic_lights": [12, 16],
            "font": "JetBrainsMono Nerd Font",
            "theme": {"light": "qingci", "dark": "xuanmo"},
            "children": [{
                "id": "root",
                "type": "row",
                "children": [{
                    "id": "brand",
                    "type": "block",
                    "content": {"mod": "inkstone-chrome"},
                }],
            }],
        }
        self.write_layout()

    def tearDown(self):
        self.tmp.cleanup()

    def write_layout(self):
        path = self.root / "layouts/oh-my-herdr.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.layout), encoding="utf-8")

    def problems(self):
        self.write_layout()
        return check.check_layout(self.root, self.files)

    def test_valid_single_root_with_document_level_chrome_passes(self):
        self.assertEqual(self.problems(), [])

    def test_rejects_missing_nerd_font_for_agent_glyphs(self):
        self.layout.pop("font")
        self.assertTrue(any("layout.font 必须指定含 Nerd Font" in p for p in self.problems()))

    def test_rejects_window_chrome_nested_under_a_column(self):
        self.layout.pop("titlebar")
        self.layout.pop("traffic_lights")
        self.layout["children"][0]["titlebar"] = "none"
        self.layout["children"][0]["traffic_lights"] = [12, 16]
        messages = "\n".join(self.problems())
        self.assertIn("layout 顶层必须声明 titlebar: none", messages)
        self.assertIn("layout 顶层必须声明两个 traffic_lights 尺寸", messages)
        self.assertIn("窗口 chrome 键只能放文档顶层", messages)

    def test_rejects_pinning_the_overlay_only_new_space_mod(self):
        self.layout["children"][0]["children"].append({
            "id": "new-space",
            "type": "block",
            "content": {"mod": "inkstone-space"},
        })
        self.assertTrue(any("inkstone-space 只能由 mod.open/openOverlay" in p
                            for p in self.problems()))

    def test_rejects_an_extra_root_sibling(self):
        self.layout["children"].append({
            "id": "extra-panel",
            "type": "block",
            "content": {"mod": "inkstone-chrome"},
        })
        self.assertTrue(any("顶层 children 必须只有一个" in p for p in self.problems()))

    def test_rejects_duplicate_node_ids(self):
        self.layout["children"][0]["children"].append({
            "id": "brand",
            "type": "block",
            "content": {"mod": "inkstone-chrome"},
        })
        self.assertTrue(any("layout 节点 id 重复: brand" in p for p in self.problems()))


if __name__ == "__main__":
    unittest.main()
