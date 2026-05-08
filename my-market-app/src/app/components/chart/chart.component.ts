import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, AfterViewInit } from '@angular/core';
import { createChart, IChartApi, ISeriesApi, LineData, Time, LineSeries, MouseEventParams } from 'lightweight-charts';

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

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Line'> | null = null;

  ngAfterViewInit(): void {
    this.createChartInstance();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.series) {
      this.series.setData(this.data);
      this.chart?.timeScale().fitContent();
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

    if (this.data.length) {
      this.series.setData(this.data);
      this.chart.timeScale().fitContent();
    }

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
