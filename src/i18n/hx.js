// UI strings for the HTML export settings (viewer Export menu, Settings page, designer report properties).
// Merged into each language by index.js and embed.js. Same keys and placeholders in every language.
export default {
  en: {
    hx_interactive: 'HTML (interactive)', hx_print: 'HTML (print)',
    hx_interactiveHint: 'The viewer in one file: groups and drill-through open in place',
    hx_printHint: 'Pages to print or archive, no viewer inside',
    hx_default: 'Default',
    hx_failed: 'The interactive HTML file could not be made: {message}',
    hx_exportPrint: 'Export print HTML instead', hx_cancel: 'Cancel',
    hx_title: 'HTML export', hx_mode: 'HTML file', hx_drill: 'Drill-through links',
    hx_notSet: 'Not set (environment, then default)', hx_serverDefault: 'Use server default',
    hx_interactiveOpt: 'Interactive', hx_tablesOpt: 'Tables', hx_printOpt: 'Print-only',
    hx_inline: 'In place (same tab)', hx_newTab: 'New tab', hx_off: 'Off (shown disabled)',
    hx_hint: 'How the viewer exports HTML unless a report says otherwise. Interactive files drill down in place, so a report sent to a client never opens broken tabs.',
    hx_effective: 'In effect: {html}, drill-through {drill}',
  },
};
