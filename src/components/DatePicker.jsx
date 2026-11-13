import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS_EU = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseIsoDate(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return { year, month, day };
}

function toIsoDate(year, monthZeroBased, day) {
  const m = String(monthZeroBased + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function formatEuropeanDate(iso) {
  const parsed = parseIsoDate(iso);
  if (!parsed) return '';
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month + 1).padStart(2, '0')}/${parsed.year}`;
}

function parseEuropeanInput(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  if (year < 1900 || year > 2100) return null;
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return toIsoDate(year, month, day);
}

/**
 * App-themed DatePicker displaying European dd/mm/yyyy format and a styled calendar popover.
 * Accepts and emits ISO YYYY-MM-DD strings.
 */
export default function DatePicker({
  value = '',
  onChange,
  placeholder = 'dd/mm/yyyy',
  required = false,
  compact = false,
  style = {}
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [textValue, setTextValue] = useState(() => formatEuropeanDate(value));
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const today = useMemo(() => {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      iso: toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())
    };
  }, []);

  const initialParsed = parseIsoDate(value);
  const [viewYear, setViewYear] = useState(initialParsed ? initialParsed.year : today.year);
  const [viewMonth, setViewMonth] = useState(initialParsed ? initialParsed.month : today.month);

  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    setTextValue(formatEuropeanDate(value));
    const parsed = parseIsoDate(value);
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }, [value]);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 288;
    const popoverHeight = 328;
    const margin = 8;

    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - popoverWidth - margin);
    }
    if (left < margin) left = margin;

    let top = rect.bottom + 6;
    if (top + popoverHeight > window.innerHeight - margin && rect.top - popoverHeight - 6 > margin) {
      top = rect.top - popoverHeight - 6;
    }

    setPopoverPos({ top, left });
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleClickOutside = (e) => {
      if (
        triggerRef.current?.contains(e.target) ||
        popoverRef.current?.contains(e.target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    const handleScrollOrResize = () => updatePosition();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen]);

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    // Convert JS Sunday=0..Saturday=6 to Monday=0..Sunday=6
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
      cells.push({
        day,
        month: prevMonth,
        year: prevYear,
        iso: toIsoDate(prevYear, prevMonth, day),
        isCurrentMonth: false
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        month: viewMonth,
        year: viewYear,
        iso: toIsoDate(viewYear, viewMonth, d),
        isCurrentMonth: true
      });
    }

    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
      const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
      cells.push({
        day: d,
        month: nextMonth,
        year: nextYear,
        iso: toIsoDate(nextYear, nextMonth, d),
        isCurrentMonth: false
      });
    }

    return cells;
  }, [viewYear, viewMonth]);

  const yearOptions = useMemo(() => {
    const base = today.year;
    const list = [];
    for (let y = base - 5; y <= base + 5; y++) {
      list.push(y);
    }
    if (!list.includes(viewYear)) {
      list.push(viewYear);
      list.sort((a, b) => a - b);
    }
    return list;
  }, [today.year, viewYear]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectIso = (iso) => {
    if (onChange) onChange(iso);
    setTextValue(formatEuropeanDate(iso));
    setIsOpen(false);
  };

  const handleTextChange = (e) => {
    const val = e.target.value;
    setTextValue(val);
    const parsedIso = parseEuropeanInput(val);
    if (parsedIso && onChange) {
      onChange(parsedIso);
      const parsed = parseIsoDate(parsedIso);
      if (parsed) {
        setViewYear(parsed.year);
        setViewMonth(parsed.month);
      }
    }
  };

  const handleTextBlur = () => {
    const parsedIso = parseEuropeanInput(textValue);
    if (parsedIso) {
      if (onChange && parsedIso !== value) onChange(parsedIso);
      setTextValue(formatEuropeanDate(parsedIso));
    } else {
      setTextValue(formatEuropeanDate(value));
    }
  };

  return (
    <div
      ref={triggerRef}
      className={`app-datepicker-wrapper ${compact ? 'is-compact' : ''}`}
      style={style}
    >
      <input
        type="text"
        className="input app-datepicker-input"
        value={textValue}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        required={required}
        inputMode="numeric"
        aria-label="Date (dd/mm/yyyy)"
      />
      <button
        type="button"
        className="app-datepicker-icon-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        tabIndex={-1}
        aria-label="Open calendar"
      >
        <Calendar size={compact ? 14 : 16} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="app-datepicker-popover"
            style={{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }}
            role="dialog"
            aria-label="Calendar date picker"
          >
            <div className="app-datepicker-header">
              <button
                type="button"
                className="app-datepicker-nav-btn"
                onClick={handlePrevMonth}
                aria-label="Previous month"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="app-datepicker-selectors">
                <select
                  className="app-datepicker-select"
                  value={viewMonth}
                  onChange={(e) => setViewMonth(Number(e.target.value))}
                  aria-label="Month"
                >
                  {MONTHS.map((m, idx) => (
                    <option key={m} value={idx}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  className="app-datepicker-select"
                  value={viewYear}
                  onChange={(e) => setViewYear(Number(e.target.value))}
                  aria-label="Year"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="app-datepicker-nav-btn"
                onClick={handleNextMonth}
                aria-label="Next month"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="app-datepicker-weekdays">
              {WEEKDAYS_EU.map((wd) => (
                <div key={wd} className="app-datepicker-weekday">
                  {wd}
                </div>
              ))}
            </div>

            <div className="app-datepicker-grid">
              {calendarDays.map((cell) => {
                const isSelected = cell.iso === value;
                const isToday = cell.iso === today.iso;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => handleSelectIso(cell.iso)}
                    className={[
                      'app-datepicker-day',
                      !cell.isCurrentMonth ? 'is-outside' : '',
                      isToday ? 'is-today' : '',
                      isSelected ? 'is-selected' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            <div className="app-datepicker-footer">
              <button
                type="button"
                className="app-datepicker-footer-btn is-today-btn"
                onClick={() => handleSelectIso(today.iso)}
              >
                Today ({formatEuropeanDate(today.iso)})
              </button>
              <button
                type="button"
                className="app-datepicker-footer-btn"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

