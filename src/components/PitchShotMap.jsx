import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

const PITCH_SVG_LENGTH = 154; // 105m / 68m * 100 for true 1:1 pitch proportions
const RESULT_COLOURS = {
  scored: '#22c55e',
  saved: '#f59e0b',
  missed: '#ea580c',
  blocked: '#6366f1'
};

const VIEW_BOXES = {
  attacking: { minX: -4, minY: -11, width: 108, height: 91 },
  defensive: { minX: -4, minY: 74, width: 108, height: 88 },
  full: { minX: -4, minY: -11, width: 108, height: 173 }
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Interactive SVG pitch for marking shot locations.
 * Stores normalized full-pitch coordinates (0..100):
 * - x: 0 (left touchline) -> 50 (goal center) -> 100 (right touchline)
 * - y: 0 (attacking goal line) -> 50 (halfway line) -> 100 (own goal line)
 */
export default function PitchShotMap({
  value,
  onChange,
  existingShots = [],
  defaultScope = 'attacking',
  allowFullScroll = false
}) {
  const svgRef = useRef(null);
  const touchStartYRef = useRef(null);
  const didSwipeRef = useRef(false);

  const [pitchScope, setPitchScope] = useState(() => {
    if (value && value.y > 50 && defaultScope === 'attacking') return 'defensive';
    return defaultScope;
  });

  const isFull = pitchScope === 'full';
  const isDefensive = pitchScope === 'defensive';
  const viewBox = VIEW_BOXES[pitchScope] || VIEW_BOXES.attacking;

  const handlePointerSelect = (e) => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }

    const svg = svgRef.current;
    if (!svg || !onChange) return;

    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const svgX = viewBox.minX + ((e.clientX - rect.left) / rect.width) * viewBox.width;
    const svgY = viewBox.minY + ((e.clientY - rect.top) / rect.height) * viewBox.height;

    const pitchX = Number(clamp(svgX, 0, 100).toFixed(1));
    const pitchY = Number(clamp((svgY / PITCH_SVG_LENGTH) * 100, 0, 100).toFixed(1));

    onChange({ x: pitchX, y: pitchY });
  };

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    touchStartYRef.current = e.touches[0].clientY;
    didSwipeRef.current = false;
  };

  const handleTouchMove = (e) => {
    if (touchStartYRef.current === null || e.touches.length !== 1) return;
    const deltaY = e.touches[0].clientY - touchStartYRef.current;
    if (Math.abs(deltaY) > 12) {
      didSwipeRef.current = true;
    }
  };

  const handleTouchEnd = (e) => {
    if (touchStartYRef.current === null || e.changedTouches.length === 0) return;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartYRef.current = null;

    if (deltaY < -35 && pitchScope === 'attacking') {
      setPitchScope('defensive');
    } else if (deltaY > 35 && pitchScope === 'defensive') {
      setPitchScope('attacking');
    }
  };

  const toSvgY = (pitchY) => (pitchY / 100) * PITCH_SVG_LENGTH;

  return (
    <div className="pitch-map-container">
      <div className="pitch-map-toolbar">
        <div className="pitch-view-toggle" role="group" aria-label="Pitch view">
          <button
            type="button"
            className={pitchScope === 'attacking' ? 'active' : ''}
            onClick={() => setPitchScope('attacking')}
          >
            Attacking
          </button>
          <button
            type="button"
            className={pitchScope === 'defensive' ? 'active' : ''}
            onClick={() => setPitchScope('defensive')}
          >
            Defensive
          </button>
          <button
            type="button"
            className={pitchScope === 'full' ? 'active' : ''}
            onClick={() => setPitchScope('full')}
          >
            Full
          </button>
        </div>
        <span className="pitch-coord-readout">
          {value ? `X ${value.x}% · Y ${value.y}%` : 'Tap pitch to mark shot'}
        </span>
      </div>

      <div
        className={`pitch-map-wrapper ${isFull ? 'is-full' : 'is-half'} ${allowFullScroll ? 'is-unclamped' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <svg
          ref={svgRef}
          viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
          onClick={handlePointerSelect}
          className="pitch-svg"
          role="img"
          aria-label="Interactive football pitch shot map"
        >
          <defs>
            <clipPath id="pitch-field-clip">
              <rect x="0" y="0" width="100" height={PITCH_SVG_LENGTH} />
            </clipPath>
          </defs>

          {/* Grass background & alternating mowing stripes */}
          <rect x="0" y="0" width="100" height={PITCH_SVG_LENGTH} fill="#15803d" rx="1" />
          <g clipPath="url(#pitch-field-clip)" opacity="0.22">
            {Array.from({ length: 10 }).map((_, i) => (
              i % 2 === 0 ? (
                <rect
                  key={i}
                  x="0"
                  y={i * (PITCH_SVG_LENGTH / 10)}
                  width="100"
                  height={PITCH_SVG_LENGTH / 10}
                  fill="#16a34a"
                />
              ) : null
            ))}
          </g>

          {/* Attacking Goal Marker & Net (top, y < 0) */}
          <g pointerEvents="none">
            <rect
              x="33"
              y="-9.8"
              width="34"
              height="4.4"
              rx="2.2"
              fill="rgba(255,255,255,0.18)"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="0.4"
            />
            <text
              x="50"
              y="-6.8"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="2.7"
              fontWeight="800"
              letterSpacing="0.35"
            >
              ↑ ATTACKING
            </text>
            <rect
              x="44.6"
              y="-4.2"
              width="10.8"
              height="4.2"
              fill="rgba(255,255,255,0.22)"
              stroke="#ffffff"
              strokeWidth="0.8"
            />
          </g>

          {/* Pitch Markings */}
          <g fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth="0.65">
            {/* Outer boundary */}
            <rect x="0" y="0" width="100" height={PITCH_SVG_LENGTH} />

            {/* Halfway line & center circle */}
            <line x1="0" y1={PITCH_SVG_LENGTH / 2} x2="100" y2={PITCH_SVG_LENGTH / 2} />
            <circle cx="50" cy={PITCH_SVG_LENGTH / 2} r="13.45" />
            <circle cx="50" cy={PITCH_SVG_LENGTH / 2} r="0.8" fill="rgba(255,255,255,0.9)" />

            {/* Attacking Penalty Area (18-yard) & 6-yard Box */}
            <rect x="20.4" y="0" width="59.2" height="24.3" />
            <rect x="36.5" y="0" width="27" height="8.1" />
            <circle cx="50" cy="16.2" r="0.75" fill="rgba(255,255,255,0.9)" />
            <path d="M 39.2 24.3 A 13.45 13.45 0 0 0 60.8 24.3" />

            {/* Attacking Corner Arcs */}
            <path d="M 2.5 0 A 2.5 2.5 0 0 1 0 2.5" />
            <path d="M 97.5 0 A 2.5 2.5 0 0 0 100 2.5" />

            {/* Own Half Markings (visible in Defensive & Full Pitch modes) */}
            {(isFull || isDefensive) && (
              <>
                <rect x="20.4" y={PITCH_SVG_LENGTH - 24.3} width="59.2" height="24.3" />
                <rect x="36.5" y={PITCH_SVG_LENGTH - 8.1} width="27" height="8.1" />
                <circle cx="50" cy={PITCH_SVG_LENGTH - 16.2} r="0.75" fill="rgba(255,255,255,0.9)" />
                <path d={`M 39.2 ${PITCH_SVG_LENGTH - 24.3} A 13.45 13.45 0 0 1 60.8 ${PITCH_SVG_LENGTH - 24.3}`} />
                <path d={`M 0 ${PITCH_SVG_LENGTH - 2.5} A 2.5 2.5 0 0 1 2.5 ${PITCH_SVG_LENGTH}`} />
                <path d={`M 100 ${PITCH_SVG_LENGTH - 2.5} A 2.5 2.5 0 0 0 97.5 ${PITCH_SVG_LENGTH}`} />
                <rect
                  x="44.6"
                  y={PITCH_SVG_LENGTH}
                  width="10.8"
                  height="3.5"
                  fill="rgba(255,255,255,0.12)"
                  stroke="rgba(255,255,255,0.75)"
                  strokeWidth="0.7"
                />
              </>
            )}
          </g>

          {/* Existing Match Shots */}
          {existingShots
            .filter((s) => typeof s.pitch_x === 'number' && typeof s.pitch_y === 'number')
            .map((shot, idx) => {
              const color = RESULT_COLOURS[shot.result] || '#ffffff';
              return (
                <circle
                  key={shot.id || `shot-${idx}`}
                  cx={shot.pitch_x}
                  cy={toSvgY(shot.pitch_y)}
                  r="1.9"
                  fill={color}
                  stroke="#ffffff"
                  strokeWidth="0.6"
                  opacity="0.9"
                />
              );
            })}

          {/* Active Selected Shot Pin */}
          {value && (
            <g transform={`translate(${value.x}, ${toSvgY(value.y)})`}>
              <circle r="4.4" fill="rgba(255, 255, 255, 0.28)" stroke="#ffffff" strokeWidth="0.65" />
              <circle r="2.2" fill="#ea580c" stroke="#ffffff" strokeWidth="0.85" />
            </g>
          )}
        </svg>
      </div>

      {!isFull && (
        <button
          type="button"
          className="pitch-half-switch-bar"
          onClick={() => setPitchScope(isDefensive ? 'attacking' : 'defensive')}
        >
          {isDefensive ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          <span>{isDefensive ? 'Switch to Attacking Half' : 'Switch to Defensive Half'}</span>
        </button>
      )}

      {existingShots.some((s) => typeof s.pitch_x === 'number') && (
        <div className="pitch-legend">
          <span><i style={{ background: RESULT_COLOURS.scored }} /> Goal</span>
          <span><i style={{ background: RESULT_COLOURS.saved }} /> Saved</span>
          <span><i style={{ background: RESULT_COLOURS.missed }} /> Missed</span>
          <span><i style={{ background: RESULT_COLOURS.blocked }} /> Blocked</span>
        </div>
      )}
    </div>
  );
}
