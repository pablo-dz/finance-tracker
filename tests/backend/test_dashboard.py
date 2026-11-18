import unittest
from datetime import date

from backend.dashboard_store import estimate_goal


class GoalEstimateTest(unittest.TestCase):
    def test_projection_uses_three_completed_months_and_calendar_months(self):
        self.assertEqual(estimate_goal("1000", "400", "900", date(2024, 1, 31)),
                         {"status": "estimated", "date": "2024-03-31"})
        self.assertEqual(estimate_goal("1000", "1000", "0", date(2024, 1, 31)),
                         {"status": "achieved", "date": None})
        self.assertEqual(estimate_goal("1000", "100", "0", date(2024, 1, 31)),
                         {"status": "insufficient", "date": None})
        self.assertEqual(estimate_goal("1000", "999.99", "0.03", date(2024, 1, 31)),
                         {"status": "estimated", "date": "2024-02-29"})
        self.assertEqual(estimate_goal("1000", "0", "0.01", date(9999, 12, 31)),
                         {"status": "out_of_range", "date": None})


if __name__ == "__main__":
    unittest.main()
