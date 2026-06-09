export class DrillDownPanel {
  constructor(containerId, engine) {
    this.container = document.getElementById(containerId);
    this.engine = engine;
    this.tooltip = null;
    this._createTooltip();
    engine.onStateChange = (state) => this.render(state);
  }

  _createTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'drill-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);
  }

  _showTooltip(e, html) {
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = 'block';
    const rect = this.tooltip.getBoundingClientRect();
    let x = e.clientX + 12;
    let y = e.clientY - 10;
    if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 12;
    if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 10;
    this.tooltip.style.left = x + 'px';
    this.tooltip.style.top = y + 'px';
  }

  _hideTooltip() {
    this.tooltip.style.display = 'none';
  }

  open() {
    this.container.classList.add('drill-panel-open');
  }

  close() {
    this.container.classList.remove('drill-panel-open');
  }

  render(state) {
    if (!state.active) {
      this.close();
      return;
    }

    this.open();
    const { breadcrumb, currentLevelData, path, cellContext } = state;
    const valueConfig = cellContext.pivotConfig.values[cellContext.valueIndex];

    let html = '';

    html += '<div class="drill-panel-header">';
    html += '<div class="drill-panel-title">数据钻取</div>';
    html += '<button class="drill-close-btn" id="drillCloseBtn">&times;</button>';
    html += '</div>';

    html += '<div class="drill-breadcrumb drill-breadcrumb-fade">';
    breadcrumb.forEach((crumb, idx) => {
      if (idx > 0) {
        html += '<span class="drill-breadcrumb-sep"> &rsaquo; </span>';
      }
      const isLast = idx === breadcrumb.length - 1;
      const cls = isLast ? 'drill-breadcrumb-item active' : 'drill-breadcrumb-item';
      html += `<span class="${cls}" data-level="${crumb.level}">${crumb.label}</span>`;
    });
    html += '</div>';

    html += '<div class="drill-context-info">';
    const valLabel = valueConfig ? valueConfig.label : '';
    html += `<span class="drill-value-label">${valLabel}</span>`;
    html += '</div>';

    if (!currentLevelData || !currentLevelData.dimension) {
      html += '<div class="drill-no-more">已无可钻取维度</div>';
      if (currentLevelData && currentLevelData.totalValue !== undefined) {
        html += `<div class="drill-total-row">
          <span class="drill-total-label">合计</span>
          <span class="drill-total-value">${this._formatNum(currentLevelData.totalValue)}</span>
        </div>`;
      }
    } else {
      const dim = currentLevelData.dimension;
      html += `<div class="drill-dimension-label">按 ${dim.label} 展开</div>`;

      html += '<div class="drill-bars-container">';
      currentLevelData.items.forEach((item, idx) => {
        const pct = Math.max(item.percent, 0.5);
        const barColor = this._getBarColor(idx);
        html += `<div class="drill-bar-row" data-value="${item.label}">
          <div class="drill-bar-label">${item.label}</div>
          <div class="drill-bar-track">
            <div class="drill-bar-fill" style="width: ${pct}%; background: ${barColor};" data-raw-value="${item.value}" data-raw-pct="${item.percent.toFixed(1)}" data-count="${item.count}"></div>
          </div>
          <div class="drill-bar-value">${this._formatNum(item.value)}</div>
          <div class="drill-bar-pct">${item.percent.toFixed(1)}%</div>
        </div>`;
      });
      html += '</div>';

      html += `<div class="drill-total-row">
        <span class="drill-total-label">合计</span>
        <span class="drill-total-value">${this._formatNum(currentLevelData.totalValue)}</span>
      </div>`;

      if (currentLevelData.hasMore) {
        html += '<div class="drill-hint">点击柱状条继续下钻</div>';
      } else {
        html += '<div class="drill-hint">已到达最深层级</div>';
      }
    }

    if (path.length > 0) {
      html += '<div class="drill-path-summary">';
      html += '<div class="drill-path-title">当前筛选条件</div>';
      path.forEach((step, idx) => {
        const dimField = this.engine.getDimensionFields().find(f => f.key === step.dimension);
        html += `<div class="drill-path-step">${dimField ? dimField.label : step.dimension}: ${step.value}</div>`;
      });
      html += '</div>';
    }

    this.container.innerHTML = html;

    this._attachEvents();
  }

  _attachEvents() {
    const closeBtn = this.container.querySelector('#drillCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.engine.close();
      });
    }

    const breadcrumbItems = this.container.querySelectorAll('.drill-breadcrumb-item:not(.active)');
    breadcrumbItems.forEach(item => {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        const level = parseInt(item.dataset.level);
        this.engine.navigateTo(level);
      });
    });

    const barRows = this.container.querySelectorAll('.drill-bar-row');
    barRows.forEach(row => {
      row.addEventListener('click', () => {
        const value = row.dataset.value;
        if (this.engine.currentLevelData && this.engine.currentLevelData.hasMore) {
          this.engine.drillDeeper(value);
        }
      });

      if (this.engine.currentLevelData && this.engine.currentLevelData.hasMore) {
        row.style.cursor = 'pointer';
      }

      const fill = row.querySelector('.drill-bar-fill');
      if (fill) {
        fill.addEventListener('mouseenter', (e) => {
          const rawValue = parseFloat(fill.dataset.rawValue);
          const rawPct = fill.dataset.rawPct;
          const count = fill.dataset.count;
          this._showTooltip(e, `数值: ${this._formatNum(rawValue)}<br>占比: ${rawPct}%<br>记录数: ${count}`);
        });
        fill.addEventListener('mousemove', (e) => {
          const rawValue = parseFloat(fill.dataset.rawValue);
          const rawPct = fill.dataset.rawPct;
          const count = fill.dataset.count;
          this._showTooltip(e, `数值: ${this._formatNum(rawValue)}<br>占比: ${rawPct}%<br>记录数: ${count}`);
        });
        fill.addEventListener('mouseleave', () => {
          this._hideTooltip();
        });
      }
    });
  }

  _formatNum(value) {
    if (typeof value !== 'number' || isNaN(value)) return '-';
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return value.toFixed(2);
  }

  _getBarColor(index) {
    const colors = [
      '#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b',
      '#fa709a', '#fee140', '#30cfd0', '#a18cd1', '#fbc2eb',
      '#ff9a9e', '#fad0c4', '#ffecd2', '#fcb69f', '#ff9a76'
    ];
    return colors[index % colors.length];
  }
}
