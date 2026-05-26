import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, AfterViewInit } from '@angular/core';
import { createChart, IChartApi, ISeriesApi, LineData, Time, LineSeries, HistogramSeries, MouseEventParams } from 'lightweight-charts';

interface VolumeProfileBin {
  price: number;
  step: number;
  volume: number;
}

@Component({
  selector: 'app-chart',
  standalone: true,
  template: `
    <div #chartWrapper class="chart-wrapper">
      <div #crosshairLabel class="crosshair-label"></div>
      <div #chartContainer class="chart-container"></div>
      <div #volumeProfile class="volume-profile"></div>
    </div>
  `,
  styles: [`
    .chart-wrapper {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 120px;
      width: 100%;
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
  `]
})
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('crosshairLabel') crosshairLabel!: ElementRef<HTMLDivElement>;
  @Input() data: LineData<Time>[] = [];
  @Input() color = '#4a9eff';
  @Input() maData: LineData<Time>[] = [];
  @Input() volumeData: LineData<Time>[] = [];
  @Input() volumeProfileData: VolumeProfileBin[] = [];

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Line'> | null = null;
  private maSeries: ISeriesApi<'Line'> | null = null;
  private volumeSeries: ISeriesApi<'Histogram'> | null = null;
  @ViewChild('volumeProfile') volumeProfile!: ElementRef<HTMLDivElement>;

  ngAfterViewInit(): void {
    this.createChartInstance();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.series) {
      this.series.setData(this.data);
      this.chart?.timeScale().fitContent();
    }
    if (changes['maData'] && this.maSeries) {
      this.maSeries.setData(this.maData);
    }
    if (changes['volumeData'] && this.volumeSeries) {
      this.volumeSeries.setData(this.volumeData);
    }
    if (changes['volumeProfileData'] && this.chart) {
      requestAnimationFrame(() => this.renderVolumeProfile());
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

    this.maSeries = this.chart.addSeries(LineSeries, {
      color: '#f0c040',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
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
      this.chart.timeScale().fitContent();
    }

    if (this.maData.length) {
      this.maSeries.setData(this.maData);
    }

    if (this.volumeData.length) {
      this.volumeSeries.setData(this.volumeData);
    }

    requestAnimationFrame(() => this.renderVolumeProfile());

    this.chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const label = this.crosshairLabel.nativeElement;
      if (!param.time) {
        label.style.display = 'none';
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
    });

    const resizeObserver = new ResizeObserver(() => {
      if (this.chart) {
        this.chart.applyOptions({
          width: container.clientWidth
        });
        requestAnimationFrame(() => this.renderVolumeProfile());
      }
    });
    resizeObserver.observe(container);
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
    const priceRange = maxPrice - minPrice || 1;
    const overlayWidth = host.clientWidth || 120;
    const chartHeight = Math.max(
      host.clientHeight || 0,
      this.chartContainer.nativeElement.clientHeight || 0,
      250,
    );
    host.style.width = `${overlayWidth}px`;
    host.style.height = `${chartHeight}px`;

    // Calibrate a single linear price→pixel mapping from two bin midpoints.
    // bin.price values are close-price bucket centres, which are always within the
    // chart's visible range, so priceToCoordinate() is guaranteed to return a number.
    // Once we have slope + intercept we can extrapolate to ANY price (including
    // bin edges that extend into the high/low territory beyond the chart's visible range).
    const calIdx1 = Math.floor(bins.length * 0.25);
    const calIdx2 = Math.floor(bins.length * 0.75);
    const calP1 = bins[calIdx1].price;
    const calP2 = bins[calIdx2].price;
    const calY1 = this.series?.priceToCoordinate(calP1);
    const calY2 = this.series?.priceToCoordinate(calP2);

    let priceToPixel: (price: number) => number;
    if (calY1 != null && calY2 != null && calP1 !== calP2) {
      const slope = ((calY2 as number) - (calY1 as number)) / (calP2 - calP1);
      const intercept = (calY1 as number) - slope * calP1;
      priceToPixel = (price: number) => slope * price + intercept;
    } else {
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
      const barWidth = Math.max(4, Math.round((bin.volume / maxVolume) * (overlayWidth - 12)));
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
      bar.setAttribute('x', String(Math.max(0, overlayWidth - barWidth)));
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
  }
}
