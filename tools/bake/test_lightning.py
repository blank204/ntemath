"""Tests for the lightning-density layer.

    python -m unittest tools.bake.test_lightning -v

Stdlib unittest rather than pytest: the repo has no Python test dependency
and this suite must run on a clean checkout with nothing but numpy.

The sampling maths (`sample_density`) was verified interactively when it was
written and those checks were never committed, so they are re-stated here --
a verification you cannot re-run is not a test.

Anything that needs the 14 MB climatology itself skips when the file is
absent: `outputs/` is gitignored, so a fresh clone legitimately lacks it.
"""

from __future__ import annotations

import os
import unittest

import numpy as np

from . import lightning


class SampleDensityTest(unittest.TestCase):
    """Resampling a lat/lon climatology onto a region grid."""

    def test_row_zero_is_the_south_edge(self):
        # A field that increases with latitude. If row 0 came out at the
        # north edge the output would descend instead -- which mirrors the
        # risk field vertically and looks entirely plausible on a map.
        lats = np.array([0.0, 1.0, 2.0, 3.0])
        lons = np.array([0.0, 1.0])
        values = np.array([[0.0, 0.0], [10.0, 10.0],
                           [20.0, 20.0], [30.0, 30.0]])
        out = lightning.sample_density(lats, lons, values,
                                       (0.0, 0.0, 1.0, 3.0), (3, 1))
        self.assertLess(out[0, 0], out[-1, 0])

    def test_matches_an_analytic_bilinear_value(self):
        lats = np.array([0.0, 1.0, 2.0, 3.0])
        lons = np.array([0.0, 1.0])
        values = np.array([[0.0, 0.0], [10.0, 10.0],
                           [20.0, 20.0], [30.0, 30.0]])
        out = lightning.sample_density(lats, lons, values,
                                       (0.0, 0.0, 1.0, 3.0), (3, 1))
        # Row 0's centre sits at lat 0.5 -> halfway between 0 and 10.
        self.assertAlmostEqual(float(out[0, 0]), 5.0, places=4)
        self.assertAlmostEqual(float(out[1, 0]), 15.0, places=4)
        self.assertAlmostEqual(float(out[2, 0]), 25.0, places=4)

    def test_north_up_and_south_up_sources_agree(self):
        lats = np.array([0.0, 1.0, 2.0, 3.0])
        lons = np.array([0.0, 1.0])
        values = np.array([[0.0, 1.0], [10.0, 11.0],
                           [20.0, 21.0], [30.0, 31.0]])
        box, shape = (0.0, 0.0, 1.0, 3.0), (5, 3)
        south_up = lightning.sample_density(lats, lons, values, box, shape)
        north_up = lightning.sample_density(lats[::-1], lons, values[::-1, :],
                                            box, shape)
        np.testing.assert_allclose(south_up, north_up)

    def test_out_of_range_clamps_instead_of_returning_nan(self):
        # A climatology that does not quite cover the box should degrade to
        # its nearest observed value, not punch holes in the risk field.
        lats = np.array([10.0, 11.0])
        lons = np.array([10.0, 11.0])
        values = np.array([[1.0, 2.0], [3.0, 4.0]])
        out = lightning.sample_density(lats, lons, values,
                                       (0.0, 0.0, 20.0, 20.0), (4, 4))
        self.assertFalse(np.isnan(out).any())
        self.assertGreaterEqual(float(out.min()), 1.0)
        self.assertLessEqual(float(out.max()), 4.0)

    def test_a_constant_field_is_preserved_exactly(self):
        lats = np.linspace(0.0, 3.0, 4)
        lons = np.linspace(0.0, 3.0, 4)
        values = np.full((4, 4), 7.5)
        out = lightning.sample_density(lats, lons, values,
                                       (0.5, 0.5, 2.5, 2.5), (9, 9))
        np.testing.assert_allclose(out, 7.5)

    def test_axis_grid_mismatch_raises(self):
        # [lon, lat] rather than [lat, lon] must fail loudly rather than
        # silently transposing the world.
        lats = np.array([0.0, 1.0, 2.0])
        lons = np.array([0.0, 1.0])
        values = np.zeros((2, 3))
        with self.assertRaises(RuntimeError):
            lightning.sample_density(lats, lons, values,
                                     (0.0, 0.0, 1.0, 2.0), (2, 2))

    def test_output_is_float32_and_contiguous(self):
        # lightning.bin is read back as a Float32Array in the browser.
        lats = np.linspace(0.0, 3.0, 4)
        lons = np.linspace(0.0, 3.0, 4)
        out = lightning.sample_density(lats, lons, np.zeros((4, 4)),
                                       (0.0, 0.0, 3.0, 3.0), (5, 5))
        self.assertEqual(out.dtype, np.dtype("<f4"))
        self.assertTrue(out.flags["C_CONTIGUOUS"])


class NormaliseTest(unittest.TestCase):

    def test_scales_the_peak_to_one(self):
        out = lightning.normalise(np.array([[0.0, 1.0], [2.0, 4.0]]))
        self.assertAlmostEqual(float(out.max()), 1.0)
        self.assertAlmostEqual(float(out[1, 0]), 0.5)

    def test_an_all_zero_field_does_not_divide_by_zero(self):
        out = lightning.normalise(np.zeros((3, 3)))
        self.assertTrue(np.all(out == 0.0))


class AxesFromTransformTest(unittest.TestCase):
    """Cell-centre axes recovered from a GDAL affine transform."""

    def test_north_up_transform_gives_descending_latitudes(self):
        # The LIS/OTD grid: 0.5 deg, origin at the NW corner.
        lats, lons = lightning.axes_from_transform(
            (-180.0, 0.5, 0.0, 90.0, 0.0, -0.5), 720, 360)
        self.assertEqual(lats.shape, (360,))
        self.assertEqual(lons.shape, (720,))
        self.assertAlmostEqual(float(lats[0]), 89.75)
        self.assertAlmostEqual(float(lats[-1]), -89.75)
        self.assertAlmostEqual(float(lons[0]), -179.75)
        self.assertAlmostEqual(float(lons[-1]), 179.75)

    def test_south_up_transform_gives_ascending_latitudes(self):
        lats, _ = lightning.axes_from_transform(
            (-180.0, 0.5, 0.0, -90.0, 0.0, 0.5), 720, 360)
        self.assertAlmostEqual(float(lats[0]), -89.75)
        self.assertAlmostEqual(float(lats[-1]), 89.75)


class RegionCellsTest(unittest.TestCase):
    """Which native climatology cells a region box actually samples."""

    def setUp(self):
        self.lats = 89.75 - np.arange(360) * 0.5
        self.lons = -179.75 + np.arange(720) * 0.5

    def test_counts_the_native_cells_whose_centres_fall_in_the_box(self):
        # James Bay: 4.6 deg of longitude and 2.2 of latitude at 0.5 deg.
        rows, cols = lightning.region_cells(
            self.lats, self.lons, (-80.8, 51.0, -76.2, 53.2))
        self.assertEqual(len(rows), 4)
        self.assertEqual(len(cols), 10)

    def test_selected_centres_lie_inside_the_box(self):
        box = (-80.8, 51.0, -76.2, 53.2)
        rows, cols = lightning.region_cells(self.lats, self.lons, box)
        west, south, east, north = box
        self.assertTrue(np.all((self.lats[rows] >= south)
                               & (self.lats[rows] <= north)))
        self.assertTrue(np.all((self.lons[cols] >= west)
                               & (self.lons[cols] <= east)))

    def test_a_box_smaller_than_one_cell_raises(self):
        # Silently returning an empty selection would make every downstream
        # statistic a division by zero.
        with self.assertRaises(RuntimeError):
            lightning.region_cells(self.lats, self.lons,
                                   (-80.9, 51.1, -80.8, 51.2))


class UniformityTest(unittest.TestCase):
    """The gradient gate's statistics, on counts rather than rates."""

    def test_a_flat_field_is_indistinguishable_from_uniform(self):
        chi2, dof, p = lightning.uniformity_chi2(np.full(40, 5.0))
        self.assertAlmostEqual(chi2, 0.0)
        self.assertEqual(dof, 39)
        self.assertGreater(p, 0.99)

    def test_a_strongly_structured_field_rejects_uniformity(self):
        counts = np.concatenate([np.full(20, 1.0), np.full(20, 20.0)])
        _, _, p = lightning.uniformity_chi2(counts)
        self.assertLess(p, 1e-6)

    def test_an_empty_field_raises_rather_than_dividing_by_zero(self):
        with self.assertRaises(RuntimeError):
            lightning.uniformity_chi2(np.zeros(40))


CLIMATOLOGY = os.path.join(lightning.CACHE_DIR, lightning.CLIMATOLOGY_FILE)


@unittest.skipUnless(os.path.isfile(CLIMATOLOGY),
                     f"climatology not cached at {CLIMATOLOGY}")
class ClimatologyFileTest(unittest.TestCase):
    """The real NASA file. Skipped on a clone that has not fetched it."""

    def test_loads_the_global_half_degree_grid(self):
        lats, lons, values = lightning.load_climatology()
        self.assertEqual(values.shape, (lats.size, lons.size))
        self.assertEqual(values.shape, (360, 720))
        self.assertAlmostEqual(float(abs(lats[1] - lats[0])), 0.5)

    def test_the_grid_is_the_documented_extent(self):
        lats, lons, _ = lightning.load_climatology()
        self.assertAlmostEqual(float(min(lats)), -89.75)
        self.assertAlmostEqual(float(max(lats)), 89.75)
        self.assertAlmostEqual(float(min(lons)), -179.75)
        self.assertAlmostEqual(float(max(lons)), 179.75)

    def test_lis_sees_nothing_at_james_bay_latitudes(self):
        # TRMM-LIS flew a 35 deg inclination and reaches about +-38 deg, so
        # everything this region shows is OTD. The source notes must say so.
        lats, lons, lis = lightning.load_climatology("HRFC_LIS_FR")
        rows, cols = lightning.region_cells(lats, lons,
                                            (-80.8, 51.0, -76.2, 53.2))
        self.assertEqual(float(lis[np.ix_(rows, cols)].max()), 0.0)

    def test_the_combined_rate_is_positive_somewhere_in_the_region(self):
        lats, lons, com = lightning.load_climatology()
        rows, cols = lightning.region_cells(lats, lons,
                                            (-80.8, 51.0, -76.2, 53.2))
        self.assertGreater(float(com[np.ix_(rows, cols)].max()), 0.0)


@unittest.skipUnless(os.path.isfile(CLIMATOLOGY),
                     f"climatology not cached at {CLIMATOLOGY}")
class GradientGateTest(unittest.TestCase):
    """The measured gate result for James Bay, pinned.

    The spec makes this a gate rather than a formality: if the strike field
    across the demo box is flat, the lightning layer is decorative and the
    honest response is to say so. These numbers are quoted in the source
    notes and the docs, so they are pinned here -- change the box, the
    variable or the statistic and this fails rather than silently restating
    a figure nobody re-derived.
    """

    JAMES_BAY = (-80.8, 51.0, -76.2, 53.2)

    @classmethod
    def setUpClass(cls):
        cls.report = lightning.gradient_report(cls.JAMES_BAY)

    def test_the_box_holds_forty_native_cells(self):
        self.assertEqual(self.report["cells"], 40)
        self.assertEqual(self.report["shape"], (4, 10))

    def test_observation_time_is_near_uniform_across_the_box(self):
        # The chi-square compares counts directly, which is only fair if
        # every cell was watched for about as long.
        self.assertLess(self.report["viewtimeSpreadPct"], 5.0)

    def test_the_field_is_not_uniform(self):
        self.assertEqual(self.report["flashes"], 218)
        self.assertAlmostEqual(self.report["chi2"], 118.1, places=0)
        self.assertLess(self.report["pUniform"], 1e-6)

    def test_lightning_increases_inland_from_the_coast(self):
        self.assertGreater(self.report["eastWestRatio"], 1.5)
        self.assertLess(self.report["pEastWest"], 1e-3)
        self.assertGreater(self.report["spearmanRho"], 0.3)

    def test_the_verdict_is_the_one_recorded_in_the_docs(self):
        self.assertEqual(self.report["verdict"], "gradient")


if __name__ == "__main__":
    unittest.main()
