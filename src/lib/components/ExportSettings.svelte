<script lang="ts">
  /**
   * v0.60.0 — Export settings tab (PDF page setup + content toggles).
   *
   * The fields here drive the native print-to-PDF path. The canvas fallback
   * path uses jsPDF's fixed A4 portrait — it ignores these values and is
   * only ever invoked when the native path fails.
   */
  import { onDestroy } from 'svelte';
  import { settingsStore, type ExportSettings, type ExportPaperSize, type ExportOrientation } from '$lib/stores/settings-store';
  import { t } from '$lib/i18n';

  let settings: ExportSettings = $state({
    pageSize: 'a4',
    orientation: 'portrait',
    margins: { top: 20, right: 15, bottom: 20, left: 15 },
    headerEnabled: false,
    headerTemplate: '{title}',
    footerEnabled: true,
    footerTemplate: '{page} / {total}',
    fontFamily: '',
    fontSize: 11,
    enableHighlight: true,
    enableMermaid: true,
    enableMath: true,
    autoFallbackOnFailure: true,
  });

  const unsub = settingsStore.subscribe((s) => {
    if (s.exportSettings) {
      settings = {
        ...s.exportSettings,
        margins: { ...s.exportSettings.margins },
      };
    }
  });
  onDestroy(() => unsub());

  function persist(patch: Partial<ExportSettings>): void {
    const next: ExportSettings = {
      ...settings,
      ...patch,
      margins: patch.margins ? { ...patch.margins } : { ...settings.margins },
    };
    settings = next;
    settingsStore.update({ exportSettings: next });
  }

  function setMargin(side: 'top' | 'right' | 'bottom' | 'left', value: number): void {
    const v = isFinite(value) ? Math.max(0, Math.min(50, value)) : 0;
    persist({ margins: { ...settings.margins, [side]: v } });
  }

  const PAPER_OPTIONS: { value: ExportPaperSize; labelKey: string }[] = [
    { value: 'a4',     labelKey: 'settings.export.paperA4' },
    { value: 'letter', labelKey: 'settings.export.paperLetter' },
    { value: 'legal',  labelKey: 'settings.export.paperLegal' },
    { value: 'a3',     labelKey: 'settings.export.paperA3' },
    { value: 'a5',     labelKey: 'settings.export.paperA5' },
  ];

  const FONT_SIZE_OPTIONS = [9, 10, 11, 12, 14];
</script>

<div class="export-settings">
  <h3 class="section-header">{$t('settings.tabs.export')}</h3>
  <p class="tab-desc">{$t('settings.tabDesc.export')}</p>

  <div class="row">
    <label class="field">
      <span class="label">{$t('settings.export.paperSize')}</span>
      <select
        value={settings.pageSize}
        onchange={(e) => persist({ pageSize: (e.currentTarget as HTMLSelectElement).value as ExportPaperSize })}
      >
        {#each PAPER_OPTIONS as opt}
          <option value={opt.value}>{$t(opt.labelKey)}</option>
        {/each}
      </select>
    </label>

    <div class="field">
      <span class="label">{$t('settings.export.orientation')}</span>
      <div class="radio-group">
        <label>
          <input
            type="radio"
            name="orientation"
            checked={settings.orientation === 'portrait'}
            onchange={() => persist({ orientation: 'portrait' as ExportOrientation })}
          />
          {$t('settings.export.orientationPortrait')}
        </label>
        <label>
          <input
            type="radio"
            name="orientation"
            checked={settings.orientation === 'landscape'}
            onchange={() => persist({ orientation: 'landscape' as ExportOrientation })}
          />
          {$t('settings.export.orientationLandscape')}
        </label>
      </div>
    </div>
  </div>

  <fieldset class="group">
    <legend>{$t('settings.export.margins')}</legend>
    <div class="margins-row">
      <label class="field-inline">
        <span>{$t('settings.export.marginsTop')}</span>
        <input
          type="number"
          min="0"
          max="50"
          step="1"
          value={settings.margins.top}
          onchange={(e) => setMargin('top', Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="unit">mm</span>
      </label>
      <label class="field-inline">
        <span>{$t('settings.export.marginsRight')}</span>
        <input
          type="number" min="0" max="50" step="1"
          value={settings.margins.right}
          onchange={(e) => setMargin('right', Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="unit">mm</span>
      </label>
      <label class="field-inline">
        <span>{$t('settings.export.marginsBottom')}</span>
        <input
          type="number" min="0" max="50" step="1"
          value={settings.margins.bottom}
          onchange={(e) => setMargin('bottom', Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="unit">mm</span>
      </label>
      <label class="field-inline">
        <span>{$t('settings.export.marginsLeft')}</span>
        <input
          type="number" min="0" max="50" step="1"
          value={settings.margins.left}
          onchange={(e) => setMargin('left', Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="unit">mm</span>
      </label>
    </div>
  </fieldset>

  <fieldset class="group">
    <legend>{$t('settings.export.headerFooter')}</legend>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.headerEnabled}
        onchange={(e) => persist({ headerEnabled: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.export.headerEnabled')}</span>
    </label>
    <input
      type="text"
      class="template-input"
      disabled={!settings.headerEnabled}
      value={settings.headerTemplate}
      onchange={(e) => persist({ headerTemplate: (e.currentTarget as HTMLInputElement).value })}
    />

    <label class="check">
      <input
        type="checkbox"
        checked={settings.footerEnabled}
        onchange={(e) => persist({ footerEnabled: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.export.footerEnabled')}</span>
    </label>
    <input
      type="text"
      class="template-input"
      disabled={!settings.footerEnabled}
      value={settings.footerTemplate}
      onchange={(e) => persist({ footerTemplate: (e.currentTarget as HTMLInputElement).value })}
    />

    <p class="hint">{$t('settings.export.templateHint')}</p>
  </fieldset>

  <fieldset class="group">
    <legend>{$t('settings.export.typography')}</legend>
    <label class="field">
      <span class="label">{$t('settings.export.fontFamily')}</span>
      <input
        type="text"
        placeholder={$t('settings.export.fontFamilyPlaceholder')}
        value={settings.fontFamily}
        onchange={(e) => persist({ fontFamily: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
    <label class="field">
      <span class="label">{$t('settings.export.fontSize')}</span>
      <select
        value={settings.fontSize}
        onchange={(e) => persist({ fontSize: Number((e.currentTarget as HTMLSelectElement).value) })}
      >
        {#each FONT_SIZE_OPTIONS as size}
          <option value={size}>{size}pt</option>
        {/each}
      </select>
    </label>
  </fieldset>

  <fieldset class="group">
    <legend>{$t('settings.export.content')}</legend>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.enableHighlight}
        onchange={(e) => persist({ enableHighlight: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.export.enableHighlight')}</span>
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.enableMath}
        onchange={(e) => persist({ enableMath: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.export.enableMath')}</span>
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.enableMermaid}
        onchange={(e) => persist({ enableMermaid: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.export.enableMermaid')}</span>
    </label>
  </fieldset>

  <fieldset class="group">
    <legend>{$t('settings.export.advanced')}</legend>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.autoFallbackOnFailure}
        onchange={(e) => persist({ autoFallbackOnFailure: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.export.autoFallback')}</span>
    </label>
    <p class="hint">{$t('settings.export.autoFallbackHint')}</p>
  </fieldset>
</div>

<style>
  .export-settings {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.5rem 0;
  }
  .section-header {
    font-size: 1.1em;
    margin: 0;
  }
  .tab-desc {
    color: var(--text-secondary);
    font-size: 0.9em;
    margin: 0;
  }
  .row {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 180px;
  }
  .field .label {
    font-size: 0.9em;
    color: var(--text-secondary);
  }
  .field-inline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9em;
    color: var(--text-primary);
  }
  .field-inline input[type='number'] {
    width: 60px;
  }
  .unit {
    color: var(--text-secondary);
    font-size: 0.85em;
  }
  .group {
    border: 1px solid var(--border-light);
    border-radius: 4px;
    padding: 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
  }
  .group legend {
    color: var(--text-primary);
    font-weight: 500;
    padding: 0 0.3rem;
  }
  .margins-row {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .radio-group {
    display: flex;
    gap: 1rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
  .check input {
    margin: 0;
  }
  .template-input {
    margin-left: 1.4rem;
    width: calc(100% - 1.4rem);
  }
  .template-input:disabled {
    opacity: 0.5;
  }
  .hint {
    color: var(--text-secondary);
    font-size: 0.82em;
    margin: 0;
    line-height: 1.4;
  }
  select, input[type='text'], input[type='number'] {
    padding: 0.3rem 0.4rem;
    background: var(--bg-primary);
    border: 1px solid var(--border-light);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 0.9em;
  }
</style>
