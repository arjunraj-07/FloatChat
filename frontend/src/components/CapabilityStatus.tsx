'use client';

/**
 * What this build can and cannot do, read from the backend capability
 * registry and shown in About Data. Unavailable items are listed here rather
 * than offered as working controls.
 */

import type { CapabilityReport } from '@/lib/planContract.ts';
import type { ViewMode } from '@/lib/explorerModel.ts';

const FRIENDLY: Record<string, string> = {
  profile_summary: 'Profile summaries',
  depth_profile: 'Depth profiles',
  woa_climatology_comparison: 'Difference from climatology (WOA23, cached references only)',
  temperature_gradient: 'Temperature change with depth (per-profile gradients)',
  thermocline_estimation: 'Thermocline estimate (strongest eligible cooling interval)',
  salinity_gradient: 'Salinity change with depth (per-profile gradients)',
  marine_heatwave_detection: 'Marine-heatwave detection',
  anomaly_significance_test: 'Statistical significance tests',
  forecast: 'Forecasting',
  float_map: 'Regional float map',
  depth_profile_chart: 'Depth-profile charts',
  coverage_summary: 'Coverage summary',
  evidence_panel: 'Quality and provenance evidence',
  globe_webgl: '3D globe',
  time_animation: 'Time animation',
  comparison_view: 'Compare periods or regions',
  ocean_story: 'Ocean Story narratives',
};

export default function CapabilityList({
  capabilities,
  mode,
}: {
  capabilities: CapabilityReport | null;
  mode: ViewMode;
}) {
  if (!capabilities) {
    return (
      <p data-testid="capabilities" className="text-sm text-slate-600">
        Capability list unavailable.
      </p>
    );
  }
  const entries = [...Object.entries(capabilities.analyses), ...Object.entries(capabilities.outputs)];
  const available = entries.filter(([, c]) => c.implemented);
  // The registry's `globe_webgl` is a requestable query output, still not
  // offered; the globe itself is a Map Explorer view, listed as available.
  const unavailable = entries.filter(([name, c]) => !c.implemented && name !== 'globe_webgl');

  return (
    <div data-testid="capabilities" className="grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <p className="font-semibold text-slate-900">Available now</p>
        <ul className="mt-1 space-y-0.5 text-slate-800">
          {available.map(([name]) => (
            <li key={name}>✓ {FRIENDLY[name] ?? name}</li>
          ))}
          <li>✓ Two-profile comparison within a result</li>
          <li>✓ Stepping through a result&apos;s observation times</li>
          <li>✓ WebGL globe and regional depth scene (Map Explorer)</li>
          <li>✓ Query drafts proposed from a question (AI Assistant)</li>
          <li>✓ Explanations of a shown result, from its own measurements (AI Assistant)</li>
        </ul>
      </div>
      <div>
        <p className="font-semibold text-slate-900">Not yet available</p>
        <ul className="mt-1 space-y-1 text-slate-700">
          {unavailable.map(([name, capability]) => (
            <li key={name}>
              – {FRIENDLY[name] ?? name}
              {mode === 'scientific' && capability.unavailable_reason && (
                <span className="block pl-3 text-xs text-slate-500">{capability.unavailable_reason}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
