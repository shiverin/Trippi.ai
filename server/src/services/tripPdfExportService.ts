import { getMcpSafeUrl } from './notifications';
import { getTripSummary } from './tripService';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXPORTS_DIR = path.join(__dirname, '../../uploads/exports');

type AnyRecord = Record<string, any>;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value: unknown): string {
  const slug = String(value ?? 'trip')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'trip';
}

function formatDateRange(trip: AnyRecord): string {
  const start = trip.start_date ? String(trip.start_date) : '';
  const end = trip.end_date ? String(trip.end_date) : '';
  if (start && end) return `${start} to ${end}`;
  return start || end || 'Dates to be confirmed';
}

function formatTime(start: unknown, end: unknown): string {
  const s = typeof start === 'string' ? start.trim() : '';
  const e = typeof end === 'string' ? end.trim() : '';
  if (s && e) return `${s} - ${e}`;
  return s || e || '';
}

function renderList(title: string, items: string[]): string {
  const visible = items.filter(Boolean);
  if (!visible.length) return '';
  return `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <ul>${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>
  `;
}

function renderDay(day: AnyRecord): string {
  const assignments = Array.isArray(day.assignments) ? day.assignments : [];
  const notes = Array.isArray(day.notes) ? day.notes : [];
  const title = day.title || `Day ${day.day_number}`;
  const date = day.date ? ` · ${day.date}` : '';
  const assignmentHtml = assignments.length
    ? assignments
        .map((assignment: AnyRecord) => {
          const place = assignment.place || {};
          const time = formatTime(
            place.place_time ?? assignment.assignment_time,
            place.end_time ?? assignment.assignment_end_time,
          );
          const details = [place.address, place.category?.name, assignment.notes].filter(Boolean).join(' · ');
          return `
            <li>
              <strong>${escapeHtml(place.name || 'Untitled stop')}</strong>
              ${time ? `<span class="time">${escapeHtml(time)}</span>` : ''}
              ${details ? `<p>${escapeHtml(details)}</p>` : ''}
            </li>
          `;
        })
        .join('')
    : '<li class="muted">No scheduled stops yet.</li>';
  const notesHtml = notes.length
    ? `<div class="notes">${notes
        .map((note: AnyRecord) => `<p>${escapeHtml([note.time, note.text].filter(Boolean).join(' - '))}</p>`)
        .join('')}</div>`
    : '';
  return `
    <article class="day">
      <h3>${escapeHtml(title)}<span>${escapeHtml(date)}</span></h3>
      <ol>${assignmentHtml}</ol>
      ${notesHtml}
    </article>
  `;
}

function buildTripPdfHtml(summary: AnyRecord): string {
  const trip = summary.trip || {};
  const days = Array.isArray(summary.days) ? summary.days : [];
  const accommodations = Array.isArray(summary.accommodations) ? summary.accommodations : [];
  const reservations = Array.isArray(summary.reservations) ? summary.reservations : [];
  const packingItems = Array.isArray(summary.packing?.items) ? summary.packing.items : [];
  const budgetItems = Array.isArray(summary.budget?.items) ? summary.budget.items : [];
  const currency = trip.currency || summary.budget?.currency || '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(trip.title || 'Trip itinerary')}</title>
    <style>
      @page { margin: 18mm 16mm; }
      body { color: #172026; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; margin: 0; }
      header { border-bottom: 2px solid #172026; margin-bottom: 18px; padding-bottom: 14px; }
      h1 { font-size: 28px; line-height: 1.1; margin: 0 0 8px; }
      h2 { border-bottom: 1px solid #d8dee4; font-size: 17px; margin: 22px 0 10px; padding-bottom: 5px; }
      h3 { break-after: avoid; font-size: 15px; margin: 0 0 8px; }
      h3 span { color: #667085; font-size: 12px; font-weight: 400; }
      p { margin: 4px 0; }
      ol, ul { margin: 0; padding-left: 18px; }
      li { margin: 0 0 7px; }
      .meta { color: #475467; font-size: 12px; }
      .day { break-inside: avoid; border-bottom: 1px solid #eaecf0; padding: 12px 0; }
      .time { color: #475467; font-size: 11px; margin-left: 8px; }
      .notes { background: #f6f8fa; border-left: 3px solid #98a2b3; margin-top: 8px; padding: 7px 10px; }
      .muted { color: #667085; }
      .summary-grid { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 12px; }
      .summary-box { border: 1px solid #d8dee4; padding: 9px; }
      .summary-box strong { display: block; font-size: 11px; text-transform: uppercase; color: #667085; }
      footer { color: #667085; font-size: 10px; margin-top: 24px; }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(trip.title || 'Trip itinerary')}</h1>
      <p class="meta">${escapeHtml(formatDateRange(trip))}${trip.description ? ` · ${escapeHtml(trip.description)}` : ''}</p>
      <div class="summary-grid">
        <div class="summary-box"><strong>Days</strong>${days.length || 'Not set'}</div>
        <div class="summary-box"><strong>Currency</strong>${escapeHtml(currency || 'Not set')}</div>
        <div class="summary-box"><strong>Accommodations</strong>${accommodations.length}</div>
        <div class="summary-box"><strong>Reservations</strong>${reservations.length}</div>
      </div>
    </header>

    <section>
      <h2>Daily Itinerary</h2>
      ${days.map(renderDay).join('')}
    </section>

    ${renderList(
      'Accommodations',
      accommodations.map((a: AnyRecord) =>
        [
          a.place_name || a.reservation_title || 'Accommodation',
          a.check_in && `check-in ${a.check_in}`,
          a.check_out && `check-out ${a.check_out}`,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    )}

    ${renderList(
      'Reservations',
      reservations.map((r: AnyRecord) =>
        [
          r.title || r.place_name || 'Reservation',
          r.type,
          r.reservation_time,
          r.confirmation_number && `confirmation ${r.confirmation_number}`,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    )}

    ${renderList(
      'Packing Checklist',
      packingItems
        .slice(0, 80)
        .map((item: AnyRecord) => `${item.checked ? '[x]' : '[ ]'} ${item.name || item.item || 'Item'}`),
    )}

    ${renderList(
      'Budget',
      budgetItems.map((item: AnyRecord) =>
        [
          item.category,
          item.title || item.name || 'Budget item',
          item.total_price != null && `${item.total_price} ${currency}`,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    )}

    <footer>Generated by trippi.ai</footer>
  </body>
</html>`;
}

export async function exportTripPdf(tripId: number): Promise<{ filename: string; url: string; bytes: number }> {
  const summary = getTripSummary(tripId);
  if (!summary) throw new Error('Trip not found.');

  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  const trip = summary.trip || {};
  const filename = `${slugify(trip.title)}-${Date.now().toString(36)}-${randomUUID()}.pdf`;
  const filePath = path.join(EXPORTS_DIR, filename);
  const html = buildTripPdfHtml(summary);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      footerTemplate:
        '<div style="font-size:8px;color:#667085;width:100%;padding:0 16mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      headerTemplate: '<div></div>',
      margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    });
  } finally {
    await browser.close();
  }

  const stat = await fs.stat(filePath);
  const baseUrl = getMcpSafeUrl().replace(/\/+$/, '');
  return {
    filename,
    url: `${baseUrl}/uploads/exports/${encodeURIComponent(filename)}`,
    bytes: stat.size,
  };
}
