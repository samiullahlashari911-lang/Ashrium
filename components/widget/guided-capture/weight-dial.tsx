'use client';

import { useMemo, useState } from 'react';

import { SegmentedToggle } from '@/components/widget/ui/segmented-toggle';
import { WheelPicker } from '@/components/widget/ui/wheel-picker';
import { formatWeight, weightWheelValues, type WeightUnit } from '@/lib/widget/weight-units';

interface WeightDialProps {
  weightKg: number;
  onChange: (weightKg: number) => void;
  onInteract?: () => void;
}

const WEIGHT_UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
] as const;

export function WeightDial({ weightKg, onChange, onInteract }: WeightDialProps): React.JSX.Element {
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const items = useMemo(
    () => weightWheelValues(unit).map((value) => ({ value, label: formatWeight(value, unit) })),
    [unit],
  );

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-48">
        <SegmentedToggle
          ariaLabel="Weight unit"
          options={WEIGHT_UNITS}
          value={unit}
          onChange={setUnit}
        />
      </div>
      <div className="w-full max-w-[260px]">
        <WheelPicker
          ariaLabel="Weight"
          items={items}
          value={weightKg}
          onChange={onChange}
          onInteract={onInteract}
        />
      </div>
    </div>
  );
}
