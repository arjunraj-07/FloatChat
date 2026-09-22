/**
 * Two profiles, one variable, one set of axes.
 *
 * Both curves share the same numeric x and depth axes, depth increasing
 * downward. Profile A is solid blue with circles; profile B dashed orange
 * with squares, so the two stay distinct without relying on colour alone.
 * Values are exactly the executed observations: gaps stay gaps, nothing is
 * smoothed, interpolated or extrapolated, and no curve is labelled as
 * anomalous. Derived exact-depth values keep their open-diamond marker.
 */

import Plot from 'react-plotly.js';

import type { DerivedValue, Variable } from '@/lib/planContract.ts';
import type { ProfileSeries, ViewMode } from '@/lib/explorerModel.ts';
import { variableAxisTitle } from './ProfileChart';

export const COMPARE_STYLE = {
  // Lightened for the dark chart surface; the dash and symbol still carry the
  // A/B distinction, so the pair does not rely on colour alone.
  a: { color: '#63b3f5', dash: 'solid', symbol: 'circle' },
  b: { color: '#f5895a', dash: 'dash', symbol: 'square' },
} as const;

export interface CompareSide {
  series: ProfileSeries;
  label: string;
  derived: DerivedValue[];
}

interface Props {
  a: CompareSide | null;
  b: CompareSide | null;
  variable: Variable;
  mode: ViewMode;
  height: number;
}

export default function CompareChart({ a, b, variable, mode, height }: Props) {
  const unit = variable === 'temp' ? ' °C' : '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plotly trace objects are untyped by react-plotly.js
  const data: any[] = [];

  for (const [key, side] of [['a', a], ['b', b]] as const) {
    if (!side) continue;
    const style = COMPARE_STYLE[key];
    const empty = side.series.validCount === 0;
    data.push({
      x: side.series.values,
      y: side.series.depths,
      type: 'scatter',
      mode: 'lines+markers',
      connectgaps: false,
      name: `${key.toUpperCase()} · ${side.label}${empty ? ' (no valid values)' : ''}`,
      line: { color: style.color, width: 2, dash: style.dash },
      marker: { color: style.color, size: 5, symbol: style.symbol },
      hovertemplate: `${key.toUpperCase()}: %{x:.3f}${unit} at %{y:.1f} m<extra></extra>`,
      // Keeps an empty profile in the legend, so its absence is visible.
      visible: true,
    });
    for (const entry of side.derived) {
      if (entry.variable !== variable || !entry.available || entry.value === null) continue;
      data.push({
        x: [entry.value],
        y: [entry.target_depth_m],
        type: 'scatter',
        mode: 'markers',
        showlegend: false,
        marker: { color: '#ffffff', size: 13, symbol: 'diamond', line: { color: style.color, width: 2.5 } },
        hovertemplate: `${key.toUpperCase()} derived, not measured: %{x:.3f}${unit} at %{y} m<extra></extra>`,
      });
    }
  }

  // Matches ProfileChart: furniture tuned for the dark ocean surface.
  const axis = {
    showline: true,
    linecolor: 'rgba(139,203,196,0.34)',
    gridcolor: 'rgba(139,203,196,0.13)',
    zeroline: false,
    ticks: 'outside',
    tickcolor: 'rgba(139,203,196,0.34)',
    tickfont: { size: 11, color: 'rgba(228,238,236,0.74)' },
  };

  return (
    <Plot
      data={data}
      layout={{
        height,
        margin: { l: 56, r: 12, t: 12, b: 48 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        hovermode: 'closest',
        // No plot legend. Two profile names are long enough to collide with
        // each other and with the axis title in a horizontal Plotly legend,
        // and its wrapping cannot be controlled. Identity is carried by the
        // A/B selector row above the chart, which wraps with the page and
        // shows the same colour and dash for each side.
        showlegend: false,
        font: { family: 'var(--font-geist-sans), system-ui, sans-serif' },
        xaxis: {
          ...axis,
          title: { text: variableAxisTitle(variable, mode), font: { size: 12, color: '#e4eeec' } },
        },
        yaxis: {
          ...axis,
          autorange: 'reversed',
          title: { text: 'Depth (m)', font: { size: 12, color: '#e4eeec' } },
        },
      }}
      config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] }}
      useResizeHandler
      style={{ width: '100%', height }}
    />
  );
}
