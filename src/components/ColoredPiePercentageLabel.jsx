import React from 'react';
import { ANALYTICS_PIE_COLORS } from '../utils/analyticsChart';

const ColoredPiePercentageLabel = ({
  index = 0,
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  payload,
  percent,
  compact = false,
}) => {
  const percentage = Number.isFinite(Number(payload?.percentage))
    ? Number(payload.percentage)
    : Number(percent || 0) * 100;
  const smallSliceOffset = percentage > 0 && percentage < 5 ? (index % 2) * 8 : 0;
  const labelRadius = outerRadius + (compact ? 9 : 13) + smallSliceOffset;
  const x = cx + labelRadius * Math.cos((-midAngle * Math.PI) / 180);
  const y = cy + labelRadius * Math.sin((-midAngle * Math.PI) / 180);
  const displayPercentage = percentage > 0 && percentage < 1
    ? '<1%'
    : `${percentage.toFixed(0)}%`;

  return (
    <text
      x={x}
      y={y}
      fill={ANALYTICS_PIE_COLORS[index % ANALYTICS_PIE_COLORS.length]}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={compact ? 9 : 11}
      fontWeight={600}
      pointerEvents="none"
    >
      {displayPercentage}
    </text>
  );
};

export default ColoredPiePercentageLabel;
