import type { Interval } from "../types";

interface Props {
  value: Interval;
  onChange: (interval: Interval) => void;
}

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export default function IntervalSelector({ value, onChange }: Props) {
  return (
    <div className="interval-selector">
      {INTERVALS.map((i) => (
        <button
          key={i.value}
          className={`interval-btn${value === i.value ? " active" : ""}`}
          onClick={() => onChange(i.value)}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
