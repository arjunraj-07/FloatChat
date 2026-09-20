/**
 * The interim regional map.
 *
 * Two clearly separated modes:
 * - `overview`: every cached profile position, before any query has run,
 *   drawn in grey and labelled as a dataset overview.
 * - `results`: only the profiles the executed query returned. The selected
 *   profile is emphasised, its float's other profiles are joined in time
 *   order, and other floats recede.
 *
 * The view is fitted once per set of markers and panned when the selection
 * changes, so it never fights the user's own panning between renders.
 */

import { useEffect } from 'react';
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { byObservationTime, formatUtc } from '@/lib/explorerModel.ts';

export interface MapProfile {
  profile_id: string;
  platform: string;
  latitude: number;
  longitude: number;
  time: string;
  data_mode?: string;
}

interface Props {
  mode: 'overview' | 'results';
  profiles: MapProfile[];
  /** Profiles to fit the view to; defaults to `profiles`. Kept to the whole
   * result while the time navigator filters the markers, so the view does
   * not jump at each step. */
  boundsProfiles?: MapProfile[];
  selectedProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
}

const COLORS = {
  overview: '#3d4d54',
  selected: '#e6f2f0',
  sameFloat: '#8bcbc4',
  otherFloat: '#175a66',
};

/** Room kept clear along the bottom of a fitted view, where the legend sits. */
const LEGEND_CLEARANCE_PX = 110;

function FitToMarkers({ boundsKey, points }: { boundsKey: string; points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const container = map.getContainer();
    const fit = () => {
      // The card around the map can change height in the same render (the
      // time navigator grows once a result exists); fit to the current size,
      // not the size Leaflet measured earlier.
      map.invalidateSize();
      if (points.length === 1) {
        map.setView(points[0], 7);
      } else {
        map.fitBounds(points, {
          paddingTopLeft: [36, 36],
          paddingBottomRight: [36, LEGEND_CLEARANCE_PX],
          maxZoom: 8,
        });
      }
    };
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      fit();
      return;
    }
    // The map's section is hidden: fit once, when it is next shown.
    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        observer.disconnect();
        fit();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
    // Refit only when the set of markers changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, map]);
  return null;
}

/** Keeps Leaflet's idea of the map size in step with its container. */
function FollowContainerSize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      // A hidden section measures zero; keep the last view instead of
      // letting Leaflet recentre on an empty box, so user panning survives
      // switching sections.
      if (container.clientWidth > 0 && container.clientHeight > 0) map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function PanToSelection({ target }: { target: [number, number] | null }) {
  const map = useMap();
  const lat = target?.[0];
  const lon = target?.[1];
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    if (!map.getBounds().pad(-0.15).contains([lat, lon])) {
      map.panTo([lat, lon]);
    }
  }, [lat, lon, map]);
  return null;
}

export default function Map({ mode, profiles, boundsProfiles, selectedProfileId, onSelectProfile }: Props) {
  const fitTo = boundsProfiles ?? profiles;
  const points = fitTo.map((p) => [p.latitude, p.longitude] as [number, number]);
  const boundsKey = `${mode}:${fitTo.map((p) => p.profile_id).sort().join(',')}`;
  const selected = profiles.find((p) => p.profile_id === selectedProfileId) ?? null;
  const track =
    mode === 'results' && selected
      ? profiles
          .filter((p) => p.platform === selected.platform)
          .sort(byObservationTime)
          .map((p) => [p.latitude, p.longitude] as [number, number])
      : [];

  // Draw the selected profile last so it sits on top.
  const ordered = [...profiles].sort(
    (a, b) =>
      Number(a.profile_id === selectedProfileId) - Number(b.profile_id === selectedProfileId),
  );

  return (
    <MapContainer
      center={[17.5, 62.5]}
      zoom={5}
      style={{ height: '100%', width: '100%', backgroundColor: '#081b23' }}
      scrollWheelZoom
    >
      <FollowContainerSize />
      <FitToMarkers boundsKey={boundsKey} points={points} />
      <PanToSelection target={selected ? [selected.latitude, selected.longitude] : null} />
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; <a href='https://carto.com/'>CARTO</a>"
      />
      {track.length > 1 && (
        <Polyline positions={track} pathOptions={{ color: COLORS.sameFloat, weight: 2, opacity: 0.7 }} />
      )}
      {ordered.map((p) => {
        const isSelected = p.profile_id === selectedProfileId;
        const sameFloat = selected !== null && p.platform === selected.platform;
        const color =
          mode === 'overview'
            ? COLORS.overview
            : isSelected
              ? COLORS.selected
              : sameFloat
                ? COLORS.sameFloat
                : COLORS.otherFloat;
        return (
          <CircleMarker
            key={p.profile_id}
            center={[p.latitude, p.longitude]}
            radius={isSelected ? 10 : mode === 'overview' ? 6 : 7}
            pathOptions={{
              color: mode === 'overview' ? 'rgba(139,203,196,0.1)' : 'rgba(8,27,35,0.9)',
              weight: 1,
              fillColor: color,
              fillOpacity: mode === 'overview' ? 0.35 : 0.95,
            }}
            eventHandlers={{ click: () => onSelectProfile(p.profile_id) }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <span className="text-xs">
                {mode === 'overview' ? 'Cached profile' : 'Result profile'} {p.profile_id}
                <br />
                Float {p.platform} · {formatUtc(p.time, false)}
              </span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
