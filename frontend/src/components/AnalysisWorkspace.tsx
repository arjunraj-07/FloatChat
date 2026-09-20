'use client';

import type { PlanExecutionResponse } from '@/lib/planContract.ts';
import type { WoaMatchResponse } from '@/lib/explorerModel.ts';
import { SectionId } from '@/lib/navigation.ts';

import WorkspaceHeader from './WorkspaceHeader';

interface Props {
  response: PlanExecutionResponse | null;
  woa: WoaMatchResponse | null;
  onNavigate: (section: SectionId) => void;
}

export default function AnalysisWorkspace({ response, woa, onNavigate }: Props) {
  const results = response?.results;

  // Extract backend results for Analysis
  const gradients = results?.gradients || [];
  const thermoclines = results?.thermoclines || [];
  
  const analysedProfiles = results?.profiles.length || 0;
  
  const validThermo = thermoclines.filter(t => t.status === 'estimated' && t.candidate);
  const meanMldDepth = validThermo.length 
    ? validThermo.reduce((sum, t) => sum + t.candidate!.estimated_depth_m, 0) / validThermo.length 
    : null;
    
  const validGrads = gradients.filter(g => g.strongest_cooling?.interval);
  const meanStrongestGradient = validGrads.length
    ? validGrads.reduce((sum, g) => sum + g.strongest_cooling!.interval.gradient, 0) / validGrads.length
    : null;

  return (
    <div data-testid="ws-analysis" className="workspace mx-auto w-full max-w-[1280px] px-5 py-8 lg:px-8">
      <WorkspaceHeader
        eyebrow="Analysis"
        title="What can be computed from this subset"
        description="Every figure below is derived from the backend results."
        headingId="heading-analysis"
      />

      <div className="fc-grid-3 mt-6">
        <div className="fc-panel p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-[rgba(139,203,196,0.15)]">
            <span className="fc-kicker">Available</span>
            <h3 className="font-semibold text-[var(--fc-text)]">Temperature changes with depth</h3>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <div className="fc-datarow"><span>Profiles analysed</span><span className="fc-mono">{analysedProfiles}</span></div>
            <div className="fc-datarow"><span>Mean mixed-layer depth</span><span className="fc-mono">{meanMldDepth != null ? meanMldDepth.toFixed(1) + ' m' : '—'}</span></div>
            <div className="fc-datarow"><span>Mean strongest gradient</span><span className="fc-mono">{meanStrongestGradient != null ? meanStrongestGradient.toFixed(3) + ' °C/m' : '—'}</span></div>
            <button className="fc-btn fc-btn-sm mt-3 w-max" onClick={() => onNavigate('map')}>View profiles on map</button>
          </div>
        </div>

        <div className="fc-panel p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-[rgba(139,203,196,0.15)]">
            <span className="fc-kicker">Available</span>
            <h3 className="font-semibold text-[var(--fc-text)]">Salinity changes with depth</h3>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <div className="fc-datarow"><span>Profiles with salinity</span><span className="fc-mono">{results?.profiles.filter(p => p.variables['psal']?.valid_levels > 0).length || 0}</span></div>
            <div className="fc-datarow"><span>Levels dropped by QC</span><span className="fc-mono">{results?.profiles.reduce((sum, p) => sum + (p.variables['psal']?.excluded_levels || 0), 0) || 0}</span></div>
            <div className="fc-badge fc-badge-info mt-2 text-left" style={{ whiteSpace: 'normal', display: 'block' }}>
              Salinity gaps are left as gaps. Profiles with a subsurface minimum are not smoothed.
            </div>
          </div>
        </div>

        <div className="fc-panel p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-[rgba(139,203,196,0.15)]">
            <span className="fc-kicker">Available</span>
            <h3 className="font-semibold text-[var(--fc-text)]">WOA comparison</h3>
          </div>
          <div className="p-5 flex flex-col gap-3">
            {woa ? (
              <>
                <div className="fc-datarow"><span>Attempted</span><span className="fc-mono">1</span></div>
                <div className="fc-datarow"><span>Succeeded</span><span className="fc-mono">{woa.status === 'Success' ? 1 : 0}</span></div>
                <div className="fc-datarow"><span>Unavailable</span><span className="fc-mono">{woa.status !== 'Success' ? 1 : 0}</span></div>
                <div className="fc-datarow"><span>Mean difference</span><span className="fc-mono">{woa.status === 'Success' && woa.difference != null ? (woa.difference > 0 ? '+' : '') + woa.difference.toFixed(3) + ' °C' : '—'}</span></div>
              </>
            ) : (
              <div className="fc-datarow"><span>No comparison data available</span></div>
            )}
            <div className="mt-2 text-xs text-[var(--fc-muted)] leading-relaxed">
              Failures are reported, not hidden: the 20 m maximum-gap rule rejects profiles that would need extrapolation.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
