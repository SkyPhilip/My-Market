import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, AfterViewInit } from '@angular/core';
import { createChart, IChartApi, ISeriesApi, IPriceLine, LineData, Time, LineSeries, MouseEventParams, LineStyle, AutoscaleInfo } from 'lightweight-charts';

@Component({
  selector: 'app-chart',
  standalone: true,
  template: `
    <div #chartWrapper class="chart-wrapper">
      <div #crosshairLabel class="crosshair-label"></div>
      <div #chartContainer class="chart-container"></div>
    </div>
  `,
  styles: [`
    .chart-wrapper {
      position: relative;
    }
    .chart-container {
      width: 100%;
      height: 250px;
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
      z-index: 2;
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
  @Input() stopPrice: number | null = null;
  @Input() buyPrice: number | null = null;
  @Input() maData: LineData<Time>[] = [];

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Line'> | null = null;
  private maSeries: ISeriesApi<'Line'> | null = null;
  private sellLine: IPriceLine | null = null;
  private buyLine: IPriceLine | null = null;

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
    if ((changes['stopPrice'] || changes['buyPrice'] || changes['data']) && this.series) {
      this.updatePriceLines();
    }
  }

  private updatePriceLines(): void {
    if (!this.series) return;
    if (this.sellLine) {
      this.series.removePriceLine(this.sellLine);
      this.sellLine = null;
    }
    if (this.buyLine) {
      this.series.removePriceLine(this.buyLine);
      this.buyLine = null;
    }
    if (this.stopPrice !== null) {
      this.sellLine = this.series.createPriceLine({
        price: this.stopPrice,
        color: '#dc3545',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Sell',
      });
    }
    if (this.buyPrice !== null) {
      this.buyLine = this.series.createPriceLine({
        price: this.buyPrice,
        color: '#28a745',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Buy',
      });
    }
    const stopVal = this.stopPrice;
    const buyVal = this.buyPrice;
    this.series.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (res !== null && res.priceRange !== null) {
          if (stopVal !== null) {
            res.priceRange.minValue = Math.min(res.priceRange.minValue, stopVal);
          }
          if (buyVal !== null) {
            res.priceRange.maxValue = Math.max(res.priceRange.maxValue, buyVal);
          }
        }
        return res;
      },
    });
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

    if (this.data.length) {
      this.series.setData(this.data);
      this.chart.timeScale().fitContent();
    }

    if (this.maData.length) {
      this.maSeries.setData(this.maData);
    }

    this.updatePriceLines();

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
      }
    });
    resizeObserver.observe(container);
  }
}
