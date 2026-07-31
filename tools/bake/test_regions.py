"""Tests for the bake-side region table.

    python -m unittest tools.bake.test_regions -v
"""

from __future__ import annotations

import unittest

from ._repo_import import repo_modules
from . import regions

plan, = repo_modules("plan")


class RegionTableTest(unittest.TestCase):

    def test_the_repo_table_is_carried_through_unchanged(self):
        # plan.REGIONS is read-only: this project adds regions beside it,
        # never upstream of it. If a bake-side entry ever shadowed one of
        # the repo's boxes, every pinned placement figure for that region
        # would move without anything saying so.
        for name, box in plan.REGIONS.items():
            self.assertIs(regions.REGIONS[name], box)

    def test_the_repo_table_itself_is_not_mutated(self):
        self.assertNotIn("james-bay", plan.REGIONS)

    def test_james_bay_is_the_box_the_spec_names(self):
        box = regions.REGIONS["james-bay"]
        self.assertEqual(
            (box.west, box.south, box.east, box.north),
            (-80.8, 51.0, -76.2, 53.2))

    def test_james_bay_is_about_314_by_244_km(self):
        # The size argument in the spec: at a 15 km detection radius a 66 km
        # box holds about four towers, which is not an optimisation problem.
        # And at 51-53 N a degree of longitude is only ~65 km, so 300 km
        # east-west needs ~4.6 degrees, not the ~3 mercator intuition says.
        box = regions.REGIONS["james-bay"]
        self.assertAlmostEqual(box.width_km, 314, delta=12)
        self.assertAlmostEqual(box.height_km, 244, delta=12)

    def test_every_region_declares_which_layer_drives_its_risk(self):
        # The third risk term means different things in different regions --
        # recent fire detections in the pre-pivot bake, lightning density
        # after it -- and a region whose meaning is unstated would let the
        # site describe a fire map as a lightning map.
        for name in regions.REGIONS:
            self.assertIn(regions.layer_for(name),
                          ("lightning", "fire-activity"))

    def test_james_bay_is_a_lightning_region(self):
        self.assertEqual(regions.layer_for("james-bay"), "lightning")

    def test_los_padres_keeps_the_layer_it_was_baked_with(self):
        # It is the bit-for-bit parity anchor against the team's Python and
        # the region every pinned benchmark figure was measured on. Silently
        # re-pointing its third term would invalidate all of them.
        self.assertEqual(regions.layer_for("los-padres"), "fire-activity")


if __name__ == "__main__":
    unittest.main()
