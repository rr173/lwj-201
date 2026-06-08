export class ChartEngine {
  constructor(container) {
    this.container = container;
    this.chartType = 'bar';
    this.data = null;
    this.opacity = 1;
    this.animating = false;
    this.tooltipData = null;
    this.hoveredIndex = -1;
    this.pointPositions = [];

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    this.ctx = this.canvas.getContext('2d');

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.style.display = 'none';

    this.container.appendChild(this.canvas);
    this.container.appendChild(this.tooltip);

    this.setupCanvasEvents();
    this.resizeCanvas();
    this.setupResizeObserver();
  }

  setupResizeObserver() {
    this._resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
    });
    this._resizeObserver.observe(this.container);
  }

  resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    if (this.data) {
      this.draw();
    }
  }

  setupCanvasEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.handleHover(x, y);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredIndex = -1;
      this.tooltip.style.display = 'none';
      if (this.data) this.draw();
    });
  }

  handleHover(x, y) {
    if (!this.data || this.chartType === 'pie') return;

    const padding = this.getPadding();
    const chartWidth = this.width - padding.left - padding.right;
    const chartHeight = this.height - padding.top - padding.bottom;

    if (this.chartType === 'bar') {
      const labels = this.data.labels;
      const barGroupWidth = chartWidth / labels.length;
      const barPadding = barGroupWidth * 0.15;
      const barWidth = (barGroupWidth - barPadding * 2) / this.data.series.length;

      let found = -1;
      for (let i = 0; i < labels.length; i++) {
        const groupX = padding.left + i * barGroupWidth;
        if (x >= groupX && x < groupX + barGroupWidth) {
          found = i;
          break;
        }
      }

      if (found !== this.hoveredIndex) {
        this.hoveredIndex = found;
        this.draw();
        if (found >= 0) {
          const idx = found;
          let text = `${labels[idx]}`;
          this.data.series.forEach((s, si) => {
            text += `\n${s.name}: ${this.formatNumber(s.values[idx])}`;
          });
          this.showTooltip(x, y, text);
        } else {
          this.tooltip.style.display = 'none';
        }
      } else if (found >= 0) {
        this.updateTooltipPosition(x, y);
      }
    } else if (this.chartType === 'line') {
      let closest = -1;
      let minDist = 20;
      this.pointPositions.forEach((p, i) => {
        const dist = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      });

      if (closest !== this.hoveredIndex) {
        this.hoveredIndex = closest;
        this.draw();
        if (closest >= 0) {
          const label = this.data.labels[closest];
          let text = `${label}`;
          this.data.series.forEach((s) => {
            text += `\n${s.name}: ${this.formatNumber(s.values[closest])}`;
          });
          this.showTooltip(x, y, text);
        } else {
          this.tooltip.style.display = 'none';
        }
      } else if (closest >= 0) {
        this.updateTooltipPosition(x, y);
      }
    }
  }

  showTooltip(x, y, text) {
    this.tooltip.textContent = '';
    text.split('\n').forEach((line, i) => {
      if (i > 0) this.tooltip.appendChild(document.createElement('br'));
      this.tooltip.appendChild(document.createTextNode(line));
    });
    this.tooltip.style.display = 'block';
    this.updateTooltipPosition(x, y);
  }

  updateTooltipPosition(x, y) {
    const rect = this.container.getBoundingClientRect();
    let left = x + 12;
    let top = y - 10;
    if (left + 140 > rect.width) left = x - 140;
    if (top < 0) top = 4;
    this.tooltip.style.left = left + 'px';
    this.tooltip.style.top = top + 'px';
  }

  setData(data, chartType) {
    if (chartType && chartType !== this.chartType) {
      this.animateTransition(chartType, data);
    } else {
      this.data = data;
      this.draw();
    }
  }

  setChartType(type) {
    if (type === this.chartType) return;
    this.animateTransition(type, this.data);
  }

  animateTransition(newType, data) {
    if (this.animating) return;
    this.animating = true;
    const duration = 300;
    const startTime = performance.now();
    const oldType = this.chartType;

    const fadeOut = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / (duration / 2), 1);
      this.opacity = 1 - progress;
      this.draw();

      if (progress < 1) {
        requestAnimationFrame(fadeOut);
      } else {
        this.chartType = newType;
        if (data) this.data = data;
        const halfTime = performance.now();
        const fadeIn = (now2) => {
          const elapsed2 = now2 - halfTime;
          const progress2 = Math.min(elapsed2 / (duration / 2), 1);
          this.opacity = progress2;
          this.draw();

          if (progress2 < 1) {
            requestAnimationFrame(fadeIn);
          } else {
            this.opacity = 1;
            this.animating = false;
          }
        };
        requestAnimationFrame(fadeIn);
      }
    };
    requestAnimationFrame(fadeOut);
  }

  clear() {
    this.data = null;
    this.hoveredIndex = -1;
    this.pointPositions = [];
    this.tooltip.style.display = 'none';
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawEmptyState();
  }

  drawEmptyState() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#999';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('点击透视表的行头或列头', this.width / 2, this.height / 2 - 14);
    ctx.fillText('生成对应图表', this.width / 2, this.height / 2 + 14);
    ctx.restore();
  }

  getPadding() {
    return { top: 30, right: 30, bottom: 50, left: 60 };
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    if (!this.data) {
      this.drawEmptyState();
      return;
    }

    ctx.save();
    ctx.globalAlpha = this.opacity;

    if (this.chartType === 'bar') {
      this.drawBar();
    } else if (this.chartType === 'line') {
      this.drawLine();
    } else if (this.chartType === 'pie') {
      this.drawPie();
    }

    ctx.restore();
  }

  drawBar() {
    const ctx = this.ctx;
    const padding = this.getPadding();
    const chartWidth = this.width - padding.left - padding.right;
    const chartHeight = this.height - padding.top - padding.bottom;
    const labels = this.data.labels;
    const series = this.data.series;

    let minVal = 0;
    let maxVal = 0;
    series.forEach(s => {
      s.values.forEach(v => {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      });
    });

    const range = maxVal - minVal || 1;
    const niceRange = this.niceNum(range);
    const niceMin = Math.floor(minVal / niceRange) * niceRange;
    const niceMax = Math.ceil(maxVal / niceRange) * niceRange;
    const adjustedRange = niceMax - niceMin || 1;
    const tickStep = niceRange;

    const yScale = chartHeight / adjustedRange;
    const zeroY = padding.top + (niceMax / adjustedRange) * chartHeight;

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#999';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let val = niceMin; val <= niceMax; val += tickStep) {
      const y = padding.top + ((niceMax - val) / adjustedRange) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
      ctx.fillText(this.formatNumber(val), padding.left - 8, y);
    }

    if (minVal < 0) {
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(padding.left + chartWidth, zeroY);
      ctx.stroke();
      ctx.fillStyle = '#888';
      ctx.font = 'bold 11px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('0', padding.left + 4, zeroY - 8);
    }

    const barGroupWidth = chartWidth / labels.length;
    const barPadding = barGroupWidth * 0.15;
    const barWidth = (barGroupWidth - barPadding * 2) / series.length;

    const colors = this.getSeriesColors();

    series.forEach((s, si) => {
      s.values.forEach((val, i) => {
        const x = padding.left + i * barGroupWidth + barPadding + si * barWidth;
        const barH = Math.abs(val) * yScale;
        const y = val >= 0 ? zeroY - barH : zeroY;

        ctx.fillStyle = colors[si % colors.length];
        if (this.hoveredIndex === i) {
          ctx.globalAlpha = this.opacity * 0.75;
        }

        const radius = 3;
        this.roundRect(ctx, x, y, barWidth, barH, val >= 0 ? radius : 0, val >= 0 ? 0 : radius);
        ctx.fill();
        ctx.globalAlpha = this.opacity;
      });
    });

    ctx.fillStyle = '#666';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    labels.forEach((label, i) => {
      const x = padding.left + i * barGroupWidth + barGroupWidth / 2;
      const truncated = this.truncateLabel(label, barGroupWidth - 4);
      ctx.fillText(truncated, x, padding.top + chartHeight + 8);
    });

    this.drawLegend(series, colors);
  }

  drawLine() {
    const ctx = this.ctx;
    const padding = this.getPadding();
    const chartWidth = this.width - padding.left - padding.right;
    const chartHeight = this.height - padding.top - padding.bottom;
    const labels = this.data.labels;
    const series = this.data.series;

    let minVal = 0;
    let maxVal = 0;
    series.forEach(s => {
      s.values.forEach(v => {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      });
    });

    const range = maxVal - minVal || 1;
    const niceRange = this.niceNum(range);
    const niceMin = Math.floor(minVal / niceRange) * niceRange;
    const niceMax = Math.ceil(maxVal / niceRange) * niceRange;
    const adjustedRange = niceMax - niceMin || 1;

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#999';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let val = niceMin; val <= niceMax + niceRange * 0.01; val += niceRange) {
      const y = padding.top + ((niceMax - val) / adjustedRange) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
      ctx.fillText(this.formatNumber(val), padding.left - 8, y);
    }

    if (minVal < 0) {
      const zeroY = padding.top + (niceMax / adjustedRange) * chartHeight;
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(padding.left + chartWidth, zeroY);
      ctx.stroke();
    }

    const colors = this.getSeriesColors();
    this.pointPositions = [];

    series.forEach((s, si) => {
      ctx.strokeStyle = colors[si % colors.length];
      ctx.lineWidth = 2;
      ctx.beginPath();

      s.values.forEach((val, i) => {
        const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartWidth;
        const y = padding.top + ((niceMax - val) / adjustedRange) * chartHeight;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        this.pointPositions.push({ x, y, seriesIndex: si, pointIndex: i });
      });

      ctx.stroke();

      s.values.forEach((val, i) => {
        const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartWidth;
        const y = padding.top + ((niceMax - val) / adjustedRange) * chartHeight;

        ctx.fillStyle = '#fff';
        ctx.strokeStyle = colors[si % colors.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (this.hoveredIndex === i) {
          ctx.fillStyle = colors[si % colors.length];
          ctx.font = 'bold 11px -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(this.formatNumber(val), x, y - 12);
        }
      });
    });

    ctx.fillStyle = '#666';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    labels.forEach((label, i) => {
      const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartWidth;
      const truncated = this.truncateLabel(label, 60);
      ctx.fillText(truncated, x, padding.top + chartHeight + 8);
    });

    this.drawLegend(series, colors);
  }

  drawPie() {
    const ctx = this.ctx;
    const series = this.data.series;
    if (!series.length || !series[0].values.length) return;

    const centerX = this.width / 2;
    const centerY = this.height / 2 + 10;
    const radius = Math.min(this.width, this.height) / 2 - 80;

    const s = series[0];
    const total = s.values.reduce((a, b) => a + Math.abs(b), 0);
    if (total === 0) return;

    const colors = this.getSeriesColors();
    let startAngle = -Math.PI / 2;

    s.values.forEach((val, i) => {
      const sliceAngle = (Math.abs(val) / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;

      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (sliceAngle > 0.15) {
        const midAngle = startAngle + sliceAngle / 2;
        const labelR = radius * 0.65;
        const lx = centerX + Math.cos(midAngle) * labelR;
        const ly = centerY + Math.sin(midAngle) * labelR;
        const pct = ((Math.abs(val) / total) * 100).toFixed(1) + '%';

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pct, lx, ly);
      }

      startAngle = endAngle;
    });

    const labelStartY = this.height - 30;
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    const labels = this.data.labels;
    const legendWidth = labels.length * 18;
    const legendStartX = (this.width - legendWidth) / 2;

    labels.forEach((label, i) => {
      const x = legendStartX + i * 18;
      if (x > this.width - 40) return;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, labelStartY, 8, 8);
    });

    this.drawLegend(series, colors);
  }

  drawLegend(series, colors) {
    const ctx = this.ctx;
    const legendY = 8;
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let x = this.getPadding().left;
    series.forEach((s, i) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, legendY, 12, 12);
      x += 16;
      ctx.fillStyle = '#555';
      const truncated = s.name.length > 10 ? s.name.substring(0, 10) + '…' : s.name;
      ctx.fillText(truncated, x, legendY + 6);
      x += ctx.measureText(truncated).width + 16;
    });
  }

  roundRect(ctx, x, y, w, h, rtl, rtr) {
    const rr = (v) => Math.max(0, v);
    ctx.beginPath();
    ctx.moveTo(x + rr(rtl), y);
    ctx.lineTo(x + w - rr(rtr), y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr(rtr));
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + rr(rtl));
    ctx.quadraticCurveTo(x, y, x + rr(rtl), y);
    ctx.closePath();
  }

  truncateLabel(label, maxWidth) {
    if (!label) return '';
    const ctx = this.ctx;
    ctx.font = '11px -apple-system, sans-serif';
    if (ctx.measureText(label).width <= maxWidth) return label;
    let truncated = label;
    while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '…';
  }

  niceNum(range) {
    const exponent = Math.floor(Math.log10(range || 1));
    const fraction = range / Math.pow(10, exponent);
    let niceFraction;
    if (fraction <= 1.5) niceFraction = 1;
    else if (fraction <= 3) niceFraction = 2;
    else if (fraction <= 7) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * Math.pow(10, exponent);
  }

  formatNumber(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    if (Math.abs(val) >= 10000) return (val / 10000).toFixed(1) + '万';
    if (Math.abs(val) >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(2);
  }

  getSeriesColors() {
    return [
      '#667eea', '#f56565', '#48bb78', '#ed8936', '#9f7aea',
      '#38b2ac', '#e53e3e', '#d69e2e', '#3182ce', '#e53e8a'
    ];
  }

  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    this.canvas.remove();
    this.tooltip.remove();
  }
}
