/**
 * Depth profile for one executed profile, as small multiples.
 *
 * Temperature and salinity get their own panels sharing one depth axis,
 * instead of two x-scales stacked on one plot, which would imply an arbitrary
 * alignment between the two. Depth increases downward. Levels without a valid
 * value are null, so lines break at gaps rather than bridging them. Values
 * interpolated to an exact depth are drawn as open diamonds on their own
 * trace so they cannot be read as measured levels.
 */

import Plot from 'react-plotly.js';

import type { DerivedValue, Variable } from '@/lib/planContract.ts';
import type { ViewMode } from '@/lib/explorerModel.ts';

export const SERIES_COLOR: Record<Variable, string> = {
  temp: '#eb6834',
  psal: '#2a78d6',
};

// Axis furniture for the dark ocean surface the charts actually sit on. The
// chart used to be a white rectangle pasted onto a navy page, and its grey
// ticks and titles were tuned for that white.
const AXIS = {
  showline: true,
  linecolor: 'rgba(139,203,196,0.34)',
  gridcolor: 'rgba(139,203,196,0.13)',
  zeroline: false,
  ticks: 'outside',
  tickcolor: 'rgba(139,203,196,0.34)',
  tickfont: { size: 11, color: 'rgba(228,238,236,0.74)' },
  title: { font: { size: 12, color: '#e4eeec' } },
};

export function variableAxisTitle(variable: Variable, mode: ViewMode): string {
  if (mode === 'scientific') {
    return variable === 'temp'
      ? 'In-situ temperature, TEMP (°C, ITS-90)'
      : 'Practical salinity, PSAL (PSS-78)';
  }
  // Practical salinity has no unit; saying so keeps the axis from looking
  // unlabelled without inventing one.
  return variable === 'temp' ? 'Temperature (°C)' : 'Salinity (PSS-78, no unit)';
}

interface Level {
  depth: number;
  temp?: number | null;
  psal?: number | null;
}

interface Props {
  observations: Level[];
  variables: Variable[];
  derived?: DerivedValue[];
  /** The supporting interval of a thermocline estimate, marked as a band.
   * Drawn behind the measurements so it never obscures them. */
  thermocline?: { upperDepth: number; lowerDepth: number; estimatedDepth: number } | null;
  mode: ViewMode;
  height: number;
  /** Why a variable has no values, shown in its empty panel. */
  emptyMessages?: Partial<Record<Variable, string>>;
}

export default function ProfileChart({
  observations,
  variables,
  derived = [],
  thermocline = null,
  mode,
  height,
  emptyMessages = {},
}: Props) {
  const levels = [...observations].sort((a, b) => a.depth - b.depth);
  const depths = levels.map((level) => level.depth);
  const panels = variables.length > 0 ? variables : (['temp'] as Variable[]);
  const width = 1 / panels.length;
  const gap = panels.length > 1 ? 0.06 : 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plotly trace/layout objects are untyped by react-plotly.js
  const data: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layout: any = {
    height,
    shapes: thermocline ? [{
      type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1,
      y0: thermocline.upperDepth, y1: thermocline.lowerDepth,
      fillcolor: 'rgba(89,200,190,0.14)', line: { width: 0 }, layer: 'below',
    }, {
      type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1,
      y0: thermocline.estimatedDepth, y1: thermocline.estimatedDepth,
      line: { color: '#59c8be', width: 1.5, dash: 'dash' }, layer: 'below',
    }] : [],
    margin: { l: 56, r: 12, t: 30, b: 48 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    showlegend: false,
    hovermode: 'closest',
    font: { family: 'var(--font-geist-sans), system-ui, sans-serif' },
    yaxis: {
      ...AXIS,
      title: { ...AXIS.title, text: 'Depth (m)' },
      autorange: 'reversed',
    },
    annotations: [],
  };

  if (thermocline) {
    // A derived marker, labelled as derived, drawn beneath the measurements.
    layout.annotations.push({
      xref: 'paper',
      yref: 'y',
      x: 0.01,
      y: thermocline.estimatedDepth,
      text: 'estimated thermocline depth (derived)',
      showarrow: false,
      xanchor: 'left',
      yanchor: 'bottom',
      font: { size: 10, color: '#8bcbc4' },
    });
  }

  panels.forEach((variable, index) => {
    const axisKey = index === 0 ? 'x' : `x${index + 1}`;
    const layoutKey = index === 0 ? 'xaxis' : `xaxis${index + 1}`;
    const values = levels.map((level) => {
      const value = level[variable];
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    });
    const hasValues = values.some((value) => value !== null);
    const start = index * width + (index > 0 ? gap / 2 : 0);
    const end = (index + 1) * width - (index < panels.length - 1 ? gap / 2 : 0);
    const unit = variable === 'temp' ? ' °C' : '';

    layout[layoutKey] = {
      ...AXIS,
      domain: [start, end],
      anchor: 'y',
      title: { ...AXIS.title, text: variableAxisTitle(variable, mode) },
      // An empty panel keeps a fixed, unlabelled scale instead of borrowing
      // (and distorting) another variable's range.
      ...(hasValues ? {} : { range: [0, 1], showticklabels: false, showgrid: false, ticks: '' }),
    };

    if (hasValues) {
      data.push({
        x: values,
        y: depths,
        xaxis: axisKey,
        yaxis: 'y',
        type: 'scatter',
        mode: 'lines+markers',
        connectgaps: false,
        line: { color: SERIES_COLOR[variable], width: 2 },
        marker: { color: SERIES_COLOR[variable], size: 4 },
        hovertemplate: `%{x:.3f}${unit} at %{y:.1f} m<extra></extra>`,
        name: variableAxisTitle(variable, mode),
      });
    } else {
      // Plotly only draws an axis that has a trace, so the empty panel gets an
      // invisible placeholder; the note uses paper coordinates for the same
      // reason.
      data.push({
        x: [null],
        y: [null],
        xaxis: axisKey,
        yaxis: 'y',
        type: 'scatter',
        mode: 'markers',
        hoverinfo: 'skip',
        showlegend: false,
      });
      layout.annotations.push({
        xref: 'paper',
        yref: 'paper',
        x: (start + end) / 2,
        y: 0.5,
        showarrow: false,
        align: 'center',
        text: (emptyMessages[variable] ?? 'No valid values in this profile')
          .replace(/(.{1,28})(\s|$)/g, '$1<br>'),
        font: { size: 12, color: '#57534e' },
      });
    }

    for (const entry of derived) {
      if (entry.variable !== variable || !entry.available || entry.value === null) continue;
      data.push({
        x: [entry.value],
        y: [entry.target_depth_m],
        xaxis: axisKey,
        yaxis: 'y',
        type: 'scatter',
        mode: 'markers',
        marker: {
          color: '#ffffff',
          size: 13,
          symbol: 'diamond',
          line: { color: SERIES_COLOR[variable], width: 2.5 },
        },
        hovertemplate:
          `Derived, not measured: %{x:.3f}${unit} at %{y} m` +
          ` (${entry.method === 'exact' ? 'exact level' : 'interpolated'})<extra></extra>`,
        name: 'Derived',
      });
    }
  });

  return (
    <Plot
      data={data}
      layout={layout}
      config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] }}
      useResizeHandler
      style={{ width: '100%', height }}
    />
  );
}
