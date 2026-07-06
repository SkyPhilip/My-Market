import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, AfterViewInit } from '@angular/core';
import { createChart, IChartApi, ISeriesApi, LineData, Time, LineSeries, HistogramSeries, HistogramData, MouseEventParams } from 'lightweight-charts';

/**
 * lightweight-charts v5 series primitive that shades the pane background from the left
 * edge up to a given time (used to highlight the previous trading session on 1D charts).
 */
class SessionShadePrimitive {
  #chart: IChartApi | null = null;
  #enabled = false;
  #until: Time | null = null;
  #requestUpdate?: () => void;

  attached(param: { chart: IChartApi; requestUpdate: () => void }): void {
    this.#chart = param.chart;
    this.#requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.#chart = null;
    this.#requestUpdate = undefined;
  }

  setState(enabled: boolean, until: Time | null): void {
    this.#enabled = enabled;
    this.#until = until;
    this.#requestUpdate?.();
  }

  updateAllViews(): void { /* state pulled lazily in the renderer */ }

  paneViews() {
    const self = this;
    return [{
      zOrder: () => 'bottom' as const,
      renderer: () => ({
        draw: (target: { useBitmapCoordinateSpace: (cb: (scope: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; bitmapSize: { height: number } }) => void) => void }) => {
          if (!self.#enabled || self.#until === null || !self.#chart) return;
          const x = self.#chart.timeScale().timeToCoordinate(self.#until);
          if (x === null) return;
          target.useBitmapCoordinateSpace(scope => {
            const right = x * scope.horizontalPixelRatio;
            if (right <= 0) return;
            scope.context.fillStyle = 'rgba(120, 144, 200, 0.10)';
            scope.context.fillRect(0, 0, right, scope.bitmapSize.height);
          });
        },
      }),
    }];
  }
}

interface VolumeProfileBin {
  price: number;
  step: number;
  volume: number;
}

@Component({
  selector: 'app-chart',
  standalone: true,
  template: `
    <div #chartWrapper class="chart-wrapper" [class.fill]="fillHeight">
      <div #crosshairLabel class="crosshair-label"></div>
      <div #maTooltip class="ma-tooltip"></div>
      <div #chartContainer class="chart-container"></div>
      <div #volumeProfile class="volume-profile"></div>
    </div>
  `,
  styles: [`
    .chart-wrapper {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 120px;
      width: 100%;
      position: relative;
    }
    .volume-profile {
      position: relative;
      width: 120px;
      min-width: 120px;
      max-width: 120px;
      height: 250px;
      pointer-events: auto;
      z-index: 2;
      background: linear-gradient(to left, rgba(26, 26, 46, 0.95), rgba(26, 26, 46, 0.7));
      border-left: 1px solid #2a3a5e;
      overflow: hidden;
      display: block;
    }
    .volume-profile svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .volume-profile__header {
      position: absolute;
      top: 2px;
      left: 14px;
      right: 4px;
      padding: 1px 4px;
      border-radius: 3px;
      background: rgba(15, 26, 48, 0.92);
      border: 1px solid rgba(42, 58, 94, 0.9);
      color: #e0e0e0;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
      text-align: center;
      z-index: 4;
      cursor: help;
      pointer-events: auto;
    }
    .volume-profile__title {
      fill: #e0e0e0;
      font-size: 10px;
      font-weight: 600;
    }
    .volume-profile__value-area {
      fill: rgba(40, 167, 69, 0.12);
      stroke: rgba(40, 167, 69, 0.45);
      stroke-width: 1;
    }
    .volume-profile__bar {
      fill: rgba(74, 158, 255, 0.42);
      opacity: 1;
      stroke: rgba(74, 158, 255, 0.7);
      stroke-width: 1;
    }
    .chart-container {
      min-width: 0;
      width: 100%;
      height: 250px;
      position: relative;
      z-index: 1;
    }
    .chart-wrapper.fill {
      height: 100%;
    }
    .chart-wrapper.fill .chart-container {
      height: 100%;
    }
    .chart-wrapper.fill .volume-profile {
      height: 100%;
    }
    .crosshair-label {
      position: absolute;
      top: 4px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(74, 158, 255, 0.85);
      color: #fff;
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 4px;
      pointer-events: none;
      z-index: 3;
      white-space: nowrap;
      display: none;
    }
    .ma-tooltip {
      position: absolute;
      top: 6px;
      left: 8px;
      background: rgba(15, 26, 48, 0.9);
      border: 1px solid rgba(42, 58, 94, 0.9);
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 11px;
      line-height: 1.3;
      padding: 4px 8px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 3;
      display: none;
    }
  `]
})
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('crosshairLabel') crosshairLabel!: ElementRef<HTMLDivElement>;
  @ViewChild('maTooltip') maTooltip!: ElementRef<HTMLDivElement>;
  @Input() data: LineData<Time>[] = [];
  @Input() color = '#4a9eff';
  @Input() maData: LineData<Time>[] = [];
  @Input() showMovingAverage = true;
  @Input() ma150Data: LineData<Time>[] = [];
  @Input() showMovingAverage150 = false;
  @Input() volumeData: LineData<Time>[] = [];
  @Input() volumeProfileData: VolumeProfileBin[] = [];
  @Input() showRangeLines = false;
  @Input() rangeHigh: number | null = null;
  @Input() rangeLow: number | null = null;
  @Input() swingHigh: number | null = null;
  @Input() swingLow: number | null = null;
  @Input() showOpeningRange = false;
  @Input() openingRangeHigh: number | null = null;
  @Input() openingRangeLow: number | null = null;
  @Input() peerData: LineData<Time>[] = [];
  @Input() showPeer = false;
  @Input() showSessionShade = false;
  @Input() sessionShadeUntil: Time | null = null;
  @Input() showMacd = false;
  @Input() fillHeight = false;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Line'> | null = null;
  private maSeries: ISeriesApi<'Line'> | null = null;
  private ma150Series: ISeriesApi<'Line'> | null = null;
  private volumeSeries: ISeriesApi<'Histogram'> | null = null;
  private rangeHighSeries: ISeriesApi<'Line'> | null = null;
  private rangeLowSeries: ISeriesApi<'Line'> | null = null;
  private swingHighSeries: ISeriesApi<'Line'> | null = null;
  private swingLowSeries: ISeriesApi<'Line'> | null = null;
  private orHighSeries: ISeriesApi<'Line'> | null = null;
  private orLowSeries: ISeriesApi<'Line'> | null = null;
  private peerSeries: ISeriesApi<'Line'> | null = null;
  private macdSeries: ISeriesApi<'Line'> | null = null;
  private macdSignalSeries: ISeriesApi<'Line'> | null = null;
  private macdHistSeries: ISeriesApi<'Histogram'> | null = null;
  private sessionShade: SessionShadePrimitive | null = null;
  @ViewChild('volumeProfile') volumeProfile!: ElementRef<HTMLDivElement>;

  ngAfterViewInit(): void {
    this.createChartInstance();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.series) {
      this.series.setData(this.data);
      this.#fitOrFocus();
      requestAnimationFrame(() => this.renderVolumeProfile());
    }
    if ((changes['maData'] || changes['showMovingAverage']) && this.maSeries) {
      this.updateMovingAverageSeries();
    }
    if ((changes['ma150Data'] || changes['showMovingAverage150']) && this.ma150Series) {
      this.updateMovingAverage150Series();
    }
    if ((changes['peerData'] || changes['showPeer']) && this.peerSeries) {
      this.updatePeerSeries();
    }
    if (changes['volumeData'] && this.volumeSeries) {
      this.volumeSeries.setData(this.volumeData);
    }
    if (changes['volumeProfileData'] && this.chart) {
      requestAnimationFrame(() => this.renderVolumeProfile());
    }
    if ((changes['showRangeLines'] || changes['rangeHigh'] || changes['rangeLow'] || changes['swingHigh'] || changes['swingLow'] || changes['data']) && this.chart) {
      this.updateRangeLines();
    }
    if ((changes['showOpeningRange'] || changes['openingRangeHigh'] || changes['openingRangeLow'] || changes['data']) && this.chart) {
      this.updateOpeningRangeLines();
    }
    if ((changes['showSessionShade'] || changes['sessionShadeUntil'] || changes['data']) && this.sessionShade) {
      this.sessionShade.setState(this.showSessionShade && this.data.length > 0, this.sessionShadeUntil);
    }
    if ((changes['showMacd'] || changes['data']) && this.chart) {
      this.updateMacd();
    }
  }

  #fitOrFocus(): void {
    if (!this.chart || !this.data.length) return;
    const ts = this.chart.timeScale();
    // For the 1D two-session view, show the current session full-width and let the
    // user scroll left into the shaded previous session; otherwise fit everything.
    if (this.showSessionShade && this.sessionShadeUntil !== null) {
      ts.setVisibleRange({ from: this.sessionShadeUntil, to: this.data[this.data.length - 1].time });
    } else {
      ts.fitContent();
    }
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
  }

  private createChartInstance(): void {
    const container = this.chartContainer.nativeElement;

    this.chart = createChart(container, {
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#a0a0b0'
      },
      grid: {
        vertLines: { color: '#2a3a5e' },
        horzLines: { color: '#2a3a5e' }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        mode: 0,
        vertLine: { labelVisible: false }
      },
      rightPriceScale: {
        borderColor: '#2a3a5e'
      }
    });

    this.series = this.chart.addSeries(LineSeries, {
      color: this.color,
      lineWidth: 2
    });

    this.sessionShade = new SessionShadePrimitive();
    this.series.attachPrimitive(this.sessionShade);
    this.sessionShade.setState(this.showSessionShade && this.data.length > 0, this.sessionShadeUntil);

    this.maSeries = this.chart.addSeries(LineSeries, {
      color: '#f0c040',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    this.ma150Series = this.chart.addSeries(LineSeries, {
      color: '#b07cff',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    this.peerSeries = this.chart.addSeries(LineSeries, {
      color: '#28a745',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      color: 'rgba(74, 158, 255, 0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
      visible: false,
    });

    if (this.data.length) {
      this.series.setData(this.data);
      this.#fitOrFocus();
    }

    this.rangeHighSeries = this.chart.addSeries(LineSeries, {
      title: 'Range High',
      color: 'rgba(255, 193, 7, 0.9)',
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    this.rangeLowSeries = this.chart.addSeries(LineSeries, {
      title: 'Range Low',
      color: 'rgba(220, 53, 69, 0.9)',
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    this.swingHighSeries = this.chart.addSeries(LineSeries, {
      title: 'Swing High',
      color: 'rgba(64, 224, 208, 0.95)',
      lineWidth: 1,
      lineStyle: 1,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    this.swingLowSeries = this.chart.addSeries(LineSeries, {
      title: 'Swing Low',
      color: 'rgba(255, 105, 180, 0.95)',
      lineWidth: 1,
      lineStyle: 1,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    this.orHighSeries = this.chart.addSeries(LineSeries, {
      title: 'OR High',
      color: '#00bcd4',
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    this.orLowSeries = this.chart.addSeries(LineSeries, {
      title: 'OR Low',
      color: '#ff9800',
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    this.updateRangeLines();

    this.updateOpeningRangeLines();

    this.updateMovingAverageSeries();
    this.updateMovingAverage150Series();
    this.updatePeerSeries();
    this.updateMacd();

    if (this.volumeData.length) {
      this.volumeSeries.setData(this.volumeData);
    }

    requestAnimationFrame(() => this.renderVolumeProfile());

    this.chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const label = this.crosshairLabel.nativeElement;
      const maTooltip = this.maTooltip.nativeElement;
      if (!param.time) {
        label.style.display = 'none';
        maTooltip.style.display = 'none';
        return;
      }

      let text: string;
      if (typeof param.time === 'string') {
        const d = new Date(param.time + 'T00:00:00');
        text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } else {
        const d = new Date((param.time as number) * 1000);
        const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
        const day = d.getUTCDate();
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        text = `${month} ${day}, ${hh}:${mm}`;
      }

      label.textContent = text;
      label.style.display = 'block';

      if (param.point) {
        label.style.left = `${param.point.x}px`;
        label.style.transform = 'translateX(-50%)';
      }

      const ma50Value = this.maSeries ? param.seriesData.get(this.maSeries) as number | undefined : undefined;
      const ma150Value = this.ma150Series ? param.seriesData.get(this.ma150Series) as number | undefined : undefined;
      const ma50Text = this.showMovingAverage && Number.isFinite(ma50Value)
        ? `<span style="color:#f0c040">50MA: ${ma50Value!.toFixed(2)}</span>`
        : '';
      const ma150Text = this.showMovingAverage150 && Number.isFinite(ma150Value)
        ? `<span style="color:#b07cff">150MA: ${ma150Value!.toFixed(2)}</span>`
        : '';

      if (!ma50Text && !ma150Text) {
        maTooltip.style.display = 'none';
      } else {
        maTooltip.innerHTML = [ma50Text, ma150Text].filter(Boolean).join('<br>');
        maTooltip.style.display = 'block';
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (this.chart) {
        this.chart.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight
        });
        requestAnimationFrame(() => this.renderVolumeProfile());
      }
    });
    resizeObserver.observe(container);
  }

  private updateRangeLines(): void {
    if (!this.rangeHighSeries || !this.rangeLowSeries || !this.swingHighSeries || !this.swingLowSeries) return;

    if (!this.showRangeLines || this.rangeHigh === null || this.rangeLow === null || this.data.length < 2) {
      this.rangeHighSeries.setData([]);
      this.rangeLowSeries.setData([]);
      this.swingHighSeries.setData([]);
      this.swingLowSeries.setData([]);
      return;
    }

    const highData: LineData<Time>[] = this.data.map(point => ({ time: point.time, value: this.rangeHigh! }));
    const lowData: LineData<Time>[] = this.data.map(point => ({ time: point.time, value: this.rangeLow! }));
    this.rangeHighSeries.setData(highData);
    this.rangeLowSeries.setData(lowData);

    const showSwingHigh = this.swingHigh !== null && this.swingHigh > this.rangeHigh;
    const showSwingLow = this.swingLow !== null && this.swingLow < this.rangeLow;

    if (showSwingHigh) {
      const swingHighData: LineData<Time>[] = this.data.map(point => ({ time: point.time, value: this.swingHigh! }));
      this.swingHighSeries.setData(swingHighData);
    } else {
      this.swingHighSeries.setData([]);
    }

    if (showSwingLow) {
      const swingLowData: LineData<Time>[] = this.data.map(point => ({ time: point.time, value: this.swingLow! }));
      this.swingLowSeries.setData(swingLowData);
    } else {
      this.swingLowSeries.setData([]);
    }
  }

  private updateOpeningRangeLines(): void {
    if (!this.orHighSeries || !this.orLowSeries) return;

    if (!this.showOpeningRange || this.openingRangeHigh === null || this.openingRangeLow === null || this.data.length < 2) {
      this.orHighSeries.setData([]);
      this.orLowSeries.setData([]);
      return;
    }

    const highData: LineData<Time>[] = this.data.map(point => ({ time: point.time, value: this.openingRangeHigh! }));
    const lowData: LineData<Time>[] = this.data.map(point => ({ time: point.time, value: this.openingRangeLow! }));
    this.orHighSeries.setData(highData);
    this.orLowSeries.setData(lowData);
  }

  private updateMovingAverageSeries(): void {
    if (!this.maSeries) return;

    if (!this.showMovingAverage || !this.maData.length) {
      this.maSeries.setData([]);
      return;
    }

    this.maSeries.setData(this.maData);
  }

  private updateMovingAverage150Series(): void {
    if (!this.ma150Series) return;

    if (!this.showMovingAverage150 || !this.ma150Data.length) {
      this.ma150Series.setData([]);
      return;
    }

    this.ma150Series.setData(this.ma150Data);
  }

  private updatePeerSeries(): void {
    if (!this.peerSeries) return;

    if (!this.showPeer || !this.peerData.length) {
      this.peerSeries.setData([]);
      return;
    }

    this.peerSeries.setData(this.peerData);
  }

  /** Exponential moving average over a numeric series (seeded with the first value). */
  private ema(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev = 0;
    for (let i = 0; i < values.length; i++) {
      prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  }

  /** Creates the second-pane MACD series when enabled and updates their data, or removes them when disabled. */
  private updateMacd(): void {
    if (!this.chart) return;

    if (!this.showMacd || this.data.length < 2) {
      this.removeMacd();
      return;
    }

    if (!this.macdHistSeries) {
      this.macdHistSeries = this.chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
        priceLineVisible: false,
        lastValueVisible: false,
      }, 1);
      this.macdSeries = this.chart.addSeries(LineSeries, {
        color: '#4a9eff',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, 1);
      this.macdSignalSeries = this.chart.addSeries(LineSeries, {
        color: '#f0934e',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, 1);
      this.chart.panes()[1]?.setHeight(120);
    }

    const values = this.data.map(d => d.value);
    const ema12 = this.ema(values, 12);
    const ema26 = this.ema(values, 26);
    const macd = values.map((_, i) => ema12[i] - ema26[i]);
    const signal = this.ema(macd, 9);

    const macdData: LineData<Time>[] = [];
    const signalData: LineData<Time>[] = [];
    const histData: HistogramData<Time>[] = [];
    for (let i = 0; i < this.data.length; i++) {
      const time = this.data[i].time;
      macdData.push({ time, value: +macd[i].toFixed(4) });
      signalData.push({ time, value: +signal[i].toFixed(4) });
      const hist = macd[i] - signal[i];
      histData.push({ time, value: +hist.toFixed(4), color: hist >= 0 ? 'rgba(40, 167, 69, 0.6)' : 'rgba(220, 53, 69, 0.6)' });
    }

    this.macdHistSeries!.setData(histData);
    this.macdSeries!.setData(macdData);
    this.macdSignalSeries!.setData(signalData);
  }

  private removeMacd(): void {
    if (!this.chart) return;
    if (this.macdSeries) this.chart.removeSeries(this.macdSeries);
    if (this.macdSignalSeries) this.chart.removeSeries(this.macdSignalSeries);
    if (this.macdHistSeries) this.chart.removeSeries(this.macdHistSeries);
    this.macdSeries = null;
    this.macdSignalSeries = null;
    this.macdHistSeries = null;
  }

  private renderVolumeProfile(): void {
    const host = this.volumeProfile?.nativeElement;
    if (!host) return;

    host.innerHTML = '';

    const bins = this.volumeProfileData;
    if (!bins.length) return;

    const maxVolume = Math.max(...bins.map(bin => bin.volume));
    if (!maxVolume) return;

    const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
    const pocIndex = bins.reduce((bestIndex, bin, index, source) => (
      bin.volume > source[bestIndex].volume ? index : bestIndex
    ), 0);

    let left = pocIndex;
    let right = pocIndex;
    let valueAreaVolume = bins[pocIndex].volume;

    while (valueAreaVolume < totalVolume * 0.7 && (left > 0 || right < bins.length - 1)) {
      const leftVolume = left > 0 ? bins[left - 1].volume : -1;
      const rightVolume = right < bins.length - 1 ? bins[right + 1].volume : -1;

      if (rightVolume >= leftVolume) {
        right += 1;
        valueAreaVolume += bins[right].volume;
      } else {
        left -= 1;
        valueAreaVolume += bins[left].volume;
      }
    }

    const minPrice = Math.min(...bins.map(bin => bin.price - bin.step / 2));
    const maxPrice = Math.max(...bins.map(bin => bin.price + bin.step / 2));
    const overlayWidth = host.clientWidth || 120;
    const chartHeight = this.chartContainer.nativeElement.clientHeight || 250;
    host.style.width = `${overlayWidth}px`;
    host.style.height = `${chartHeight}px`;

    const rightScale = this.chart?.priceScale('right');
    const visibleRange = rightScale?.getVisibleRange();

    let visibleMin = minPrice;
    let visibleMax = maxPrice;
    if (visibleRange) {
      visibleMin = Math.min(visibleRange.from, visibleRange.to);
      visibleMax = Math.max(visibleRange.from, visibleRange.to);
    }

    const visibleTopCoord = this.series?.priceToCoordinate(visibleMax);
    const visibleBottomCoord = this.series?.priceToCoordinate(visibleMin);

    let priceToPixel: (price: number) => number;
    if (visibleTopCoord != null && visibleBottomCoord != null && visibleMax > visibleMin) {
      priceToPixel = (price: number) => {
        const clampedPrice = Math.min(visibleMax, Math.max(visibleMin, price));
        const ratio = (visibleMax - clampedPrice) / (visibleMax - visibleMin);
        return visibleTopCoord + ratio * (visibleBottomCoord - visibleTopCoord);
      };
    } else {
      const priceRange = maxPrice - minPrice || 1;
      priceToPixel = (price: number) => ((maxPrice - price) / priceRange) * chartHeight;
    }

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', `0 0 ${overlayWidth} ${chartHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const header = document.createElement('div');
    header.className = 'volume-profile__header';
    header.textContent = 'Volume by Price';
    header.title = 'Volume by Price: histogram of traded volume by price level.';
    header.style.cssText = [
      'position:absolute',
      'top:2px',
      'left:14px',
      'right:4px',
      'padding:1px 4px',
      'border-radius:3px',
      'background:rgba(15,26,48,0.92)',
      'border:1px solid rgba(42,58,94,0.9)',
      'color:#e0e0e0',
      'font-size:10px',
      'font-weight:600',
      'line-height:1.2',
      'white-space:nowrap',
      'text-align:center',
      'z-index:4',
      'cursor:help',
      'pointer-events:auto',
    ].join(';');
    host.appendChild(header);

    const valueAreaTop = Math.round(priceToPixel(bins[left].price + bins[left].step / 2));
    const valueAreaBottom = Math.round(priceToPixel(bins[right].price - bins[right].step / 2));
    const valueAreaRect = document.createElementNS(svgNamespace, 'rect');
    valueAreaRect.setAttribute('fill', 'rgba(40, 167, 69, 0.12)');
    valueAreaRect.setAttribute('stroke', 'rgba(40, 167, 69, 0.45)');
    valueAreaRect.setAttribute('stroke-width', '1');
    valueAreaRect.setAttribute('x', '0');
    valueAreaRect.setAttribute('y', String(Math.min(valueAreaTop, valueAreaBottom)));
    valueAreaRect.setAttribute('width', String(overlayWidth));
    valueAreaRect.setAttribute('height', String(Math.max(1, Math.abs(valueAreaBottom - valueAreaTop))));
    valueAreaRect.setAttribute('rx', '3');
    valueAreaRect.setAttribute('ry', '3');
    svg.appendChild(valueAreaRect);

    for (let index = 0; index < bins.length; index += 1) {
      const bin = bins[index];
      const binTopPrice = bin.price + bin.step / 2;
      const binBottomPrice = bin.price - bin.step / 2;
      // Use the calibrated linear mapping (extrapolates correctly outside the chart's visible range).
      const pxTop = Math.round(Math.min(priceToPixel(binTopPrice), priceToPixel(binBottomPrice)));
      const pxBottom = Math.round(Math.max(priceToPixel(binTopPrice), priceToPixel(binBottomPrice)));
      const barHeight = Math.max(2, pxBottom - pxTop - 1); // 1px gap between bins
      const xInset = 2;
      const barWidth = Math.max(4, Math.round((bin.volume / maxVolume) * (overlayWidth - (xInset + 10))));
      const y = Math.max(0, Math.min(chartHeight - barHeight, pxTop));

      const bar = document.createElementNS(svgNamespace, 'rect');
      bar.setAttribute('class', 'volume-profile__bar');
      const isPoc = index === pocIndex;
      const isVah = index === right;
      const isVal = index === left;

      // Priority when a marker overlaps on the same bin: POC > VAH > VAL.
      const fill = isPoc
        ? 'rgba(255, 193, 7, 0.55)'
        : isVah
          ? 'rgba(40, 167, 69, 0.5)'
          : isVal
            ? 'rgba(220, 53, 69, 0.5)'
            : 'rgba(74, 158, 255, 0.42)';
      const stroke = isPoc
        ? 'rgba(255, 193, 7, 0.95)'
        : isVah
          ? 'rgba(40, 167, 69, 0.95)'
          : isVal
            ? 'rgba(220, 53, 69, 0.95)'
            : 'rgba(74, 158, 255, 0.7)';

      bar.setAttribute('fill', fill);
      bar.setAttribute('stroke', stroke);
      bar.setAttribute('x', String(xInset));
      bar.setAttribute('y', String(y));
      bar.setAttribute('width', String(barWidth));
      bar.setAttribute('height', String(barHeight));
      bar.setAttribute('rx', '2');
      bar.setAttribute('ry', '2');

      const markerParts: string[] = [];
      if (isPoc) markerParts.push('POC (Point of Control)');
      if (isVah) markerParts.push('VAH (Value Area High)');
      if (isVal) markerParts.push('VAL (Value Area Low)');

      const title = document.createElementNS(svgNamespace, 'title');
      const priceLow = binBottomPrice.toFixed(2);
      const priceHigh = binTopPrice.toFixed(2);
      const volume = Math.round(bin.volume).toLocaleString();
      title.textContent = [
        markerParts.length ? markerParts.join(' | ') : 'Volume by Price bin',
        `Price range: $${priceLow} - $${priceHigh}`,
        `Volume: ${volume}`,
      ].join('\n');
      bar.appendChild(title);

      svg.appendChild(bar);
    }

    host.appendChild(svg);

    const paneCrosshairLine = document.createElement('div');
    paneCrosshairLine.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'height:1px',
      'background:rgba(255,255,255,0.7)',
      'pointer-events:none',
      'z-index:6',
      'display:none',
    ].join(';');

    const paneCrosshairPrice = document.createElement('div');
    paneCrosshairPrice.style.cssText = [
      'position:absolute',
      'right:2px',
      'padding:1px 4px',
      'border-radius:3px',
      'background:rgba(15,26,48,0.95)',
      'border:1px solid rgba(74,158,255,0.8)',
      'color:#dfe9ff',
      'font-size:10px',
      'line-height:1.2',
      'font-weight:600',
      'pointer-events:none',
      'z-index:7',
      'display:none',
    ].join(';');

    host.appendChild(paneCrosshairLine);
    host.appendChild(paneCrosshairPrice);

    const priceFormatter = this.series?.priceFormatter();
    host.onmousemove = (event: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      const y = Math.max(0, Math.min(chartHeight - 1, event.clientY - rect.top));
      const yPx = Math.round(y);

      paneCrosshairLine.style.display = 'block';
      paneCrosshairLine.style.top = `${yPx}px`;

      const price = this.series?.coordinateToPrice(y);
      if (price != null) {
        const numericPrice = Number(price);
        paneCrosshairPrice.textContent = Number.isFinite(numericPrice)
          ? (priceFormatter ? priceFormatter.format(numericPrice) : numericPrice.toFixed(2))
          : '';

        if (paneCrosshairPrice.textContent) {
          const chipTop = Math.max(0, Math.min(chartHeight - 16, yPx - 8));
          paneCrosshairPrice.style.top = `${chipTop}px`;
          paneCrosshairPrice.style.display = 'block';
        } else {
          paneCrosshairPrice.style.display = 'none';
        }
      } else {
        paneCrosshairPrice.style.display = 'none';
      }
    };

    host.onmouseleave = () => {
      paneCrosshairLine.style.display = 'none';
      paneCrosshairPrice.style.display = 'none';
    };
  }
}
