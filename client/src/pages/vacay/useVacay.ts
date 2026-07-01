import { useMemo } from 'react';
import { useVacayStore } from '../../store/vacayStore';

export function useVacay() {
  const selectedYear = useVacayStore((s) => s.selectedYear);
  const setSelectedYear = useVacayStore((s) => s.setSelectedYear);
  const currentYear = new Date().getFullYear();

  const years = useMemo(
    () => Array.from({ length: 21 }, (_, index) => currentYear - 10 + index),
    [currentYear]
  );

  return {
    years,
    selectedYear: years.includes(selectedYear) ? selectedYear : currentYear,
    setSelectedYear,
  };
}
