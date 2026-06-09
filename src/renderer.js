import { aggregateData, buildRowHierarchy, aggregationTypes, getCellValue as getAggCellValue } from './aggregator.js';

const ROW_HEIGHT = 36;
const HEADER_ROW_HEIGHT = 36;
const BUFFER_ROWS = 5;
const VIRTUAL_THRESHOLD = 200;

export class PivotRenderer {
  constructor(container, data) {
    this.container = container;
    this.rawData = data;
    this.config = {
      rows: [],
      columns: [],
      values: [],
      filters: [],
      conditionalFormats: {}
    };
    this.collapsedNodes = new Set();
    this.highlightedCell = null;
    this.onCellDoubleClick = null;
    this.onRowToggle = null;
    this.onHeaderSelect = null;
    this.selectedHeader = null;
    this.scrollTop = 0;
    this.visibleRows = [];
    this.allRows = [];
    this.scrollHandlerAttached = false;
    this.valueStats = {};
    this.sortColumnKey = null;
    this.sortDirection = null;
    this.snapshotEngine = null;
    this.sparklineMode = null;
    this.sparklineTooltip = null;
    this._createSparklineTooltip();
  }

  _createSparklineTooltip() {
    this.sparklineTooltip = document.createElement('div');
    this.sparklineTooltip.className = 'sparkline-tooltip';
    this.sparklineTooltip.style.display = 'none';
    document.body.appendChild(this.sparklineTooltip);
  }

  _showSparklineTooltip(e, html) {
    this.sparklineTooltip.innerHTML = html;
    this.sparklineTooltip.style.display = 'block';
    const rect = this.sparklineTooltip.getBoundingClientRect();
    let x = e.clientX + 12;
    let y = e.clientY - 10;
    if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - 12;
    if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - 10;
    this.sparklineTooltip.style.left = x + 'px';
    this.sparklineTooltip.style.top = y + 'px';
  }

  _hideSparklineTooltip() {
    this.sparklineTooltip.style.display = 'none';
  }

  toggleSparkline(valueIndex) {
    if (this.snapshotEngine && this.snapshotEngine.comparisonMode) return;
    if (this.sparklineMode === valueIndex) {
      this.sparklineMode = null;
    } else {
      this.sparklineMode = valueIndex;
    }
    this.render();
  }

  isSparklineActive(valueIndex) {
    return this.sparklineMode === valueIndex;
  }

  getSparklineData(row, valueIndex) {
    const allColCombos = this.buildDataColumns();
    const sparklineCols = allColCombos.filter(c => c.valueIndex === valueIndex && !c.colKeyObj.isTotal && c.colKeyObj.key !== '__total__');
    
    const points = [];
    sparklineCols.forEach(col => {
      const value = this.getCellValue(row, col.colKeyObj, valueIndex);
      const colLabel = (col.colKeyObj.values || []).join(' / ');
      points.push({
        value: (typeof value === 'number' && !isNaN(value)) ? value : null,
        colKey: col.colKeyObj.key,
        colLabel
      });
    });

    return points;
  }

  drawSparkline(canvas, points, isSubtotalOrTotal) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const validPoints = points.filter(p => p.value !== null);
    if (validPoints.length < 2) {
      if (validPoints.length === 1) {
        ctx.fillStyle = '#667eea';
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
        ctx.fill();
        const val = validPoints[0].value;
        ctx.fillStyle = '#666';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.formatValue(val), w / 2, h / 2 + 14);
      }
      return;
    }

    const values = validPoints.map(p => p.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;

    const padX = 8;
    const padY = 8;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    const getX = (i) => padX + (i / (validPoints.length - 1)) * plotW;
    const getY = (v) => {
      if (range === 0) return padY + plotH / 2;
      return padY + (1 - (v - minVal) / range) * plotH;
    };

    ctx.beginPath();
    if (isSubtotalOrTotal) {
      ctx.setLineDash([4, 3]);
    }
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    ctx.moveTo(getX(0), getY(values[0]));
    for (let i = 1; i < validPoints.length; i++) {
      ctx.lineTo(getX(i), getY(values[i]));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    let minIdx = 0, maxIdx = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] < values[minIdx]) minIdx = i;
      if (values[i] > values[maxIdx]) maxIdx = i;
    }

    ctx.fillStyle = '#52c41a';
    ctx.beginPath();
    ctx.arc(getX(maxIdx), getY(values[maxIdx]), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#389e0d';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ff4d4f';
    ctx.beginPath();
    ctx.arc(getX(minIdx), getY(values[minIdx]), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cf1322';
    ctx.lineWidth = 1;
    ctx.stroke();

    canvas._sparklinePoints = validPoints.map((p, i) => ({
      x: getX(i),
      y: getY(p.value),
      value: p.value,
      colLabel: p.colLabel,
      colKey: p.colKey
    }));
  }
  
  updateConfig(config) {
    this.config = { ...this.config, ...config };
    this.render();
  }

  setExpanded(key, expanded) {
    if (expanded) {
      this.collapsedNodes.delete(key);
    } else {
      this.collapsedNodes.add(key);
    }
  }

  isExpanded(key) {
    return !this.collapsedNodes.has(key);
  }

  toggleExpand(key) {
    if (this.isExpanded(key)) {
      this.collapsedNodes.add(key);
    } else {
      this.collapsedNodes.delete(key);
    }
    this.render();
  }

  toggleSort(columnKey) {
    if (this.sortColumnKey !== columnKey) {
      this.sortColumnKey = columnKey;
      this.sortDirection = 'asc';
    } else {
      if (this.sortDirection === 'asc') {
        this.sortDirection = 'desc';
      } else if (this.sortDirection === 'desc') {
        this.sortColumnKey = null;
        this.sortDirection = null;
      } else {
        this.sortDirection = 'asc';
      }
    }
    this.render();
  }

  getSortArrow(columnKey) {
    if (this.sortColumnKey !== columnKey) {
      return '<span class="sort-arrow sort-none"></span>';
    }
    if (this.sortDirection === 'asc') {
      return '<span class="sort-arrow sort-asc">▲</span>';
    }
    if (this.sortDirection === 'desc') {
      return '<span class="sort-arrow sort-desc">▼</span>';
    }
    return '<span class="sort-arrow sort-none"></span>';
  }

  getSortValue(node, colKeyObj, valueIndex) {
    if (!this.aggregateResult) return 0;
    
    const rowValues = node.values || [];
    const colValues = colKeyObj && !colKeyObj.isTotal && colKeyObj.key !== '__total__' 
      ? (colKeyObj.values || []) 
      : [];
    
    const value = getAggCellValue(this.aggregateResult, rowValues, colValues, valueIndex);
    if (typeof value === 'number' && !isNaN(value)) return value;
    return 0;
  }

  buildVisibleRows() {
    const { rows } = this.config;
    
    if (this.config.values.length === 0) {
      this.allRows = [];
      return [];
    }
    
    const result = aggregateData(this.rawData, this.config);
    this.aggregateResult = result;
    
    const allRows = [];
    
    const addRow = (node, level) => {
      allRows.push({
        key: node.key,
        label: node.label,
        level,
        isSubtotal: false,
        isGrandTotal: false,
        values: node.values,
        hasChildren: node.children && node.children.length > 0
      });
      
      if (this.isExpanded(node.key) && node.children && node.children.length > 0) {
        node.children.forEach(child => {
          addRow(child, level + 1);
        });
        
        if (rows.length > 1) {
          allRows.push({
            key: `${node.key}__subtotal`,
            label: `${node.label} 小计`,
            level,
            isSubtotal: true,
            isGrandTotal: false,
            values: node.values,
            hasChildren: false
          });
        }
      }
    };
    
    if (rows.length > 0) {
      let sortFn = null;
      
      if (this.sortColumnKey && this.sortDirection) {
        const allColCombos = this.buildDataColumns();
        const sortCol = allColCombos.find(c => `${c.colKeyObj.key}__${c.valueIndex}` === this.sortColumnKey);
        
        if (sortCol) {
          sortFn = (a, b) => {
            const valA = this.getSortValue(a, sortCol.colKeyObj, sortCol.valueIndex);
            const valB = this.getSortValue(b, sortCol.colKeyObj, sortCol.valueIndex);
            return this.sortDirection === 'asc' ? valA - valB : valB - valA;
          };
        } else if (this.sortColumnKey && this.sortColumnKey.startsWith('sparkline__')) {
          const sparklineVIdx = parseInt(this.sortColumnKey.replace('sparkline__', ''));
          if (!isNaN(sparklineVIdx)) {
            sortFn = (a, b) => {
              const getSum = (node) => {
                const sparklineCols = allColCombos.filter(c => c.valueIndex === sparklineVIdx && !c.colKeyObj.isTotal && c.colKeyObj.key !== '__total__');
                let sum = 0;
                sparklineCols.forEach(col => {
                  const v = this.getSortValue(node, col.colKeyObj, sparklineVIdx);
                  sum += v;
                });
                return sum;
              };
              const valA = getSum(a);
              const valB = getSum(b);
              return this.sortDirection === 'asc' ? valA - valB : valB - valA;
            };
          }
        }
      }
      
      const hierarchy = buildRowHierarchy(result.rowKeys, rows, sortFn);
      hierarchy.forEach(node => {
        addRow(node, 0);
      });
    } else {
      allRows.push({
        key: '__total__',
        label: '总计',
        level: 0,
        isSubtotal: false,
        isGrandTotal: false,
        values: [],
        hasChildren: false
      });
    }
    
    if (rows.length > 0) {
      allRows.push({
        key: '__grand_total__',
        label: '总计',
        level: 0,
        isSubtotal: false,
        isGrandTotal: true,
        values: [],
        hasChildren: false
      });
    }
    
    this.allRows = allRows;
    return allRows;
  }

  buildColumnHeaders() {
    const { columns } = this.config;
    const result = this.aggregateResult;
    
    if (!result) return [];
    
    const allValues = result.values;
    const headers = [];
    
    if (columns.length === 0) {
      const row = [];
      allValues.forEach((v, vIdx) => {
        const colKeyObj = { key: '__total__' };
        if (this.sparklineMode === vIdx) {
          row.push({
            label: '📈 ' + (v.label || `${aggregationTypes[v.aggregation]?.label || ''}(${v.field})`),
            colSpan: 1,
            key: `sparkline__${vIdx}`,
            valueIndex: vIdx,
            colKeyObj,
            isSparkline: true
          });
        } else {
          row.push({
            label: v.label || `${aggregationTypes[v.aggregation]?.label || ''}(${v.field})`,
            colSpan: 1,
            key: `${colKeyObj.key}__${vIdx}`,
            valueIndex: vIdx,
            colKeyObj
          });
        }
      });
      headers.push(row);
    } else {
      const allColCombos = [];
      result.columnKeys.forEach(colKey => {
        allValues.forEach((v, vIdx) => {
          allColCombos.push({
            colKey,
            valueConfig: v,
            valueIndex: vIdx
          });
        });
      });
      
      allValues.forEach((v, vIdx) => {
        allColCombos.push({
          colKey: { key: '__total__', values: [], isTotal: true },
          valueConfig: v,
          valueIndex: vIdx
        });
      });

      if (this.sparklineMode !== null) {
        const sparklineVIdx = this.sparklineMode;
        const sparklineLabel = allValues[sparklineVIdx]?.label || '';
        const nonTotalSparklineCount = result.columnKeys.length;

        for (let level = 0; level < columns.length; level++) {
          const levelHeaders = [];
          let lastFullKey = null;
          let lastLabel = null;
          let spanCount = 0;
          let isSparklineGroup = false;

          const filteredCombos = allColCombos.filter(combo => {
            if (combo.valueIndex === sparklineVIdx && !combo.colKey.isTotal) return false;
            return true;
          });

          filteredCombos.forEach((combo, idx) => {
            const val = combo.colKey.values ? combo.colKey.values[level] : null;
            const fullKey = val
              ? combo.colKey.values.slice(0, level + 1).join('||')
              : (combo.colKey.isTotal ? '__total__' : null);
            const label = val || (combo.colKey.isTotal ? '总计' : '');

            if (fullKey !== lastFullKey) {
              if (lastFullKey !== null) {
                levelHeaders.push({
                  label: lastLabel,
                  colSpan: spanCount,
                  key: lastFullKey,
                  dimLevel: level
                });
              }
              lastFullKey = fullKey;
              lastLabel = label;
              spanCount = 1;
            } else {
              spanCount++;
            }

            if (idx === filteredCombos.length - 1) {
              levelHeaders.push({
                label: lastLabel,
                colSpan: spanCount,
                key: lastFullKey,
                dimLevel: level
              });
            }
          });

          const insertIdx = level === 0 ? nonTotalSparklineCount : levelHeaders.findIndex(h => h.key === '__total__');
          if (insertIdx === -1) {
            levelHeaders.push({
              label: level === 0 ? '📈 ' + sparklineLabel : '',
              colSpan: nonTotalSparklineCount,
              key: `sparkline__${sparklineVIdx}__dim${level}`,
              dimLevel: level,
              isSparkline: true
            });
          } else {
            levelHeaders.splice(insertIdx, 0, {
              label: level === 0 ? '📈 ' + sparklineLabel : '',
              colSpan: nonTotalSparklineCount,
              key: `sparkline__${sparklineVIdx}__dim${level}`,
              dimLevel: level,
              isSparkline: true
            });
          }

          headers.push(levelHeaders);
        }

        const lastLevel = [];
        allColCombos.forEach(combo => {
          if (combo.valueIndex === sparklineVIdx && !combo.colKey.isTotal) return;
          lastLevel.push({
            label: combo.valueConfig.label || `${aggregationTypes[combo.valueConfig.aggregation]?.label || ''}(${combo.valueConfig.field})`,
            colSpan: 1,
            colKeyObj: combo.colKey,
            valueIndex: combo.valueIndex,
            key: `${combo.colKey.key}__${combo.valueIndex}`
          });
        });

        const totalInsertIdx = lastLevel.findIndex(h => h.colKeyObj && h.colKeyObj.isTotal && h.valueIndex === sparklineVIdx);
        if (totalInsertIdx === -1) {
          lastLevel.push({
            label: '📈 ' + sparklineLabel,
            colSpan: nonTotalSparklineCount,
            key: `sparkline__${sparklineVIdx}`,
            valueIndex: sparklineVIdx,
            isSparkline: true
          });
        } else {
          lastLevel.splice(totalInsertIdx, 0, {
            label: '📈 ' + sparklineLabel,
            colSpan: nonTotalSparklineCount,
            key: `sparkline__${sparklineVIdx}`,
            valueIndex: sparklineVIdx,
            isSparkline: true
          });
        }

        headers.push(lastLevel);
      } else {
        for (let level = 0; level < columns.length; level++) {
          const levelHeaders = [];
          let lastFullKey = null;
          let lastLabel = null;
          let spanCount = 0;
          
          allColCombos.forEach((combo, idx) => {
            const val = combo.colKey.values ? combo.colKey.values[level] : null;
            const fullKey = val
              ? combo.colKey.values.slice(0, level + 1).join('||')
              : (combo.colKey.isTotal ? '__total__' : null);
            const label = val || (combo.colKey.isTotal ? '总计' : '');
            
            if (fullKey !== lastFullKey) {
              if (lastFullKey !== null) {
                levelHeaders.push({
                  label: lastLabel,
                  colSpan: spanCount,
                  key: lastFullKey,
                  dimLevel: level
                });
              }
              lastFullKey = fullKey;
              lastLabel = label;
              spanCount = 1;
            } else {
              spanCount++;
            }
            
            if (idx === allColCombos.length - 1) {
              levelHeaders.push({
                label: lastLabel,
                colSpan: spanCount,
                key: lastFullKey,
                dimLevel: level
              });
            }
          });
          
          headers.push(levelHeaders);
        }
        
        const lastLevel = [];
        allColCombos.forEach(combo => {
          lastLevel.push({
            label: combo.valueConfig.label || `${aggregationTypes[combo.valueConfig.aggregation]?.label || ''}(${combo.valueConfig.field})`,
            colSpan: 1,
            colKeyObj: combo.colKey,
            valueIndex: combo.valueIndex,
            key: `${combo.colKey.key}__${combo.valueIndex}`
          });
        });
        headers.push(lastLevel);
      }
    }
    
    return headers;
  }

  render() {
    this.buildVisibleRows();
    
    if (this.allRows.length === 0 || this.config.values.length === 0) {
      this.renderEmptyState();
      return;
    }
    
    this.computeValueStats();
    
    const columnHeaders = this.buildColumnHeaders();
    const useVirtualScroll = this.allRows.length > VIRTUAL_THRESHOLD;
    
    if (useVirtualScroll) {
      this.renderVirtualScroll(columnHeaders);
    } else {
      this.renderFullTable(columnHeaders);
    }
  }

  renderEmptyState() {
    this.container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3h18v18H3z"></path>
          <path d="M3 9h18"></path>
          <path d="M9 3v18"></path>
        </svg>
        <p>拖拽字段到行、列、值区域开始分析</p>
      </div>
    `;
  }

  renderFullTable(columnHeaders) {
    const { rows, values } = this.config;
    const numRowHeaderCols = Math.max(rows.length, 1);
    
    let html = '<table>';
    html += '<thead>';
    
    columnHeaders.forEach((headerRow, levelIdx) => {
      html += '<tr>';
      
      if (levelIdx === columnHeaders.length - 1) {
        if (rows.length > 0) {
          rows.forEach(r => {
            html += `<th class="row-header corner">${r}</th>`;
          });
        } else {
          html += `<th class="row-header corner">项目</th>`;
        }
      } else {
        html += `<th class="row-header corner" colspan="${numRowHeaderCols}"></th>`;
      }
      
      headerRow.forEach(header => {
        if (levelIdx === columnHeaders.length - 1 && header.key) {
          const sortClass = this.sortColumnKey === header.key ? ' sorted' : '';
          html += `<th colspan="${header.colSpan}" class="sortable-header${sortClass}" data-sort-key="${header.key}">${header.label}${this.getSortArrow(header.key)}</th>`;
        } else {
          html += `<th colspan="${header.colSpan}">${header.label}</th>`;
        }
      });
      
      html += '</tr>';
    });
    
    html += '</thead><tbody>';
    
    this.allRows.forEach(row => {
      html += this.renderRow(row);
    });
    
    html += '</tbody></table>';
    
    this.container.innerHTML = html;
    this.attachEventListeners();
    this._drawAllSparklines();
  }

  _drawAllSparklines() {
    if (this.sparklineMode === null) return;
    this.container.querySelectorAll('.sparkline-canvas').forEach(canvas => {
      const rowKey = canvas.dataset.rowKey;
      const valueIndex = parseInt(canvas.dataset.valueIndex);
      const row = this.allRows.find(r => r.key === rowKey);
      if (!row) return;
      const isSubtotalOrTotal = row.isSubtotal || row.isGrandTotal;
      const points = this.getSparklineData(row, valueIndex);
      this.drawSparkline(canvas, points, isSubtotalOrTotal);
    });
    this._attachSparklineHover();
  }

  _attachSparklineHover() {
    this.container.querySelectorAll('.sparkline-cell').forEach(cell => {
      const canvas = cell.querySelector('.sparkline-canvas');
      if (!canvas) return;

      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const points = canvas._sparklinePoints;
        if (!points || points.length === 0) return;

        let closest = points[0];
        let minDist = Math.abs(x - closest.x);
        for (let i = 1; i < points.length; i++) {
          const dist = Math.abs(x - points[i].x);
          if (dist < minDist) {
            minDist = dist;
            closest = points[i];
          }
        }

        const valLabel = this.formatValue(closest.value);
        this._showSparklineTooltip(e, `${closest.colLabel}<br>${valLabel}`);
      });

      canvas.addEventListener('mouseleave', () => {
        this._hideSparklineTooltip();
      });
    });
  }

  renderRow(row) {
    const { rows, values } = this.config;
    let html = '<tr>';
    
    if (rows.length > 0) {
      for (let colIdx = 0; colIdx < rows.length; colIdx++) {
        let content = '';
        
        if (colIdx === 0) {
          content = this.renderRowHeaderCell(row);
        } else if (colIdx === row.level + 1 && !row.isSubtotal && !row.isGrandTotal) {
          if (row.level >= colIdx - 1) {
            content = row.values[colIdx] || '';
          }
        } else if (colIdx <= row.level && !row.isSubtotal && !row.isGrandTotal) {
          content = row.values[colIdx] || '';
        }
        
        let cellClass = 'row-header';
        if (row.isGrandTotal) cellClass += ' grand-total';
        else if (row.isSubtotal) cellClass += ' subtotal';
        
        html += `<td class="${cellClass}">${content}</td>`;
      }
    } else {
      html += `<td class="row-header${row.isGrandTotal ? ' grand-total' : row.isSubtotal ? ' subtotal' : ''}">${row.label}</td>`;
    }
    
    const allColCombos = this.buildDataColumns();

    if (this.sparklineMode !== null) {
      const sparklineVIdx = this.sparklineMode;
      const sparklineCols = allColCombos.filter(c => c.valueIndex === sparklineVIdx && !c.colKeyObj.isTotal && c.colKeyObj.key !== '__total__');
      const totalSparklineSpan = sparklineCols.length;

      for (let vIdx = 0; vIdx < (this.aggregateResult ? this.aggregateResult.values.length : this.config.values.length); vIdx++) {
        if (vIdx === sparklineVIdx) {
          if (this.snapshotEngine && this.snapshotEngine.comparisonMode) {
            sparklineCols.forEach(col => {
              const value = this.getCellValue(row, col.colKeyObj, col.valueIndex);
              html += this.renderComparisonCell(row, col, value);
            });
          } else {
            let cellClass = 'data-cell sparkline-cell';
            if (row.isGrandTotal) cellClass += ' grand-total';
            else if (row.isSubtotal) cellClass += ' subtotal';

            html += `<td class="${cellClass}" colspan="${totalSparklineSpan}"
                        data-row-key="${row.key}"
                        data-col-key="sparkline"
                        data-value-index="${sparklineVIdx}">
                        <canvas class="sparkline-canvas" data-row-key="${row.key}" data-value-index="${sparklineVIdx}"></canvas>
                     </td>`;
          }
        } else {
          const colsForVIdx = allColCombos.filter(c => c.valueIndex === vIdx);
          colsForVIdx.forEach(col => {
            const value = this.getCellValue(row, col.colKeyObj, col.valueIndex);
            if (this.snapshotEngine && this.snapshotEngine.comparisonMode) {
              html += this.renderComparisonCell(row, col, value);
            } else {
              const displayValue = this.formatValue(value, col.field);
              let cellClass = 'data-cell';
              if (value === 'ERR') cellClass += ' cell-err';
              if (row.isGrandTotal) cellClass += ' grand-total';
              else if (row.isSubtotal) cellClass += ' subtotal';

              const colKey = col.colKeyObj.key || '__total__';
              const { styles, dataBarWidth } = row.isSubtotal || row.isGrandTotal
                ? { styles: [], dataBarWidth: 0 }
                : this.applyConditionalFormat(value, col.valueIndex, colKey);

              const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';

              let cellContent = displayValue;
              if (dataBarWidth > 0) {
                const dataBarRule = (this.config.conditionalFormats?.[col.valueIndex] || []).find(r => r.type === 'dataBar');
                const barColor = dataBarRule?.color || '#667eea';
                cellContent = `
                  <div class="data-bar-container">
                    <div class="data-bar" style="width: ${dataBarWidth}%; background-color: ${barColor};"></div>
                    <span class="data-bar-value">${displayValue}</span>
                  </div>
                `;
              }

              html += `<td class="${cellClass}" 
                          data-row-key="${row.key}" 
                          data-col-key="${col.colKeyObj.key}"
                          data-value-index="${col.valueIndex}"
                          ${styleAttr}>${cellContent}</td>`;
            }
          });
        }
      }
    } else {
      allColCombos.forEach(col => {
        const value = this.getCellValue(row, col.colKeyObj, col.valueIndex);

        if (this.snapshotEngine && this.snapshotEngine.comparisonMode) {
          html += this.renderComparisonCell(row, col, value);
        } else {
          const displayValue = this.formatValue(value, col.field);
          
          let cellClass = 'data-cell';
          if (value === 'ERR') cellClass += ' cell-err';
          if (row.isGrandTotal) cellClass += ' grand-total';
          else if (row.isSubtotal) cellClass += ' subtotal';
          
          const colKey = col.colKeyObj.key || '__total__';
          const { styles, dataBarWidth } = row.isSubtotal || row.isGrandTotal 
            ? { styles: [], dataBarWidth: 0 }
            : this.applyConditionalFormat(value, col.valueIndex, colKey);
          
          const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';
          
          let cellContent = displayValue;
          if (dataBarWidth > 0) {
            const dataBarRule = (this.config.conditionalFormats?.[col.valueIndex] || []).find(r => r.type === 'dataBar');
            const barColor = dataBarRule?.color || '#667eea';
            cellContent = `
              <div class="data-bar-container">
                <div class="data-bar" style="width: ${dataBarWidth}%; background-color: ${barColor};"></div>
                <span class="data-bar-value">${displayValue}</span>
              </div>
            `;
          }
          
          html += `<td class="${cellClass}" 
                      data-row-key="${row.key}" 
                      data-col-key="${col.colKeyObj.key}"
                      data-value-index="${col.valueIndex}"
                      ${styleAttr}>${cellContent}</td>`;
        }
      });
    }
    
    html += '</tr>';
    return html;
  }

  renderComparisonCell(row, col, value) {
    const comp = this.snapshotEngine.getComparisonValues(row.key, col.colKeyObj.key, col.valueIndex);
    const labels = this.snapshotEngine.getComparisonLabels();

    let cellClass = 'data-cell comparison-cell';
    if (row.isGrandTotal) cellClass += ' grand-total';
    else if (row.isSubtotal) cellClass += ' subtotal';

    let cellColorClass = '';
    if (comp && comp.diff !== null) {
      if (comp.diff > 0) cellColorClass = ' cell-up';
      else if (comp.diff < 0) cellColorClass = ' cell-down';
      else cellColorClass = ' cell-same';
    }

    const leftDisplay = comp && comp.leftVal !== null ? this.formatValue(comp.leftVal, col.field) : '-';
    const rightDisplay = comp && comp.rightVal !== null ? this.formatValue(comp.rightVal, col.field) : '-';

    let diffDisplay = '-';
    let diffClass = '';
    if (comp && comp.diff !== null) {
      const sign = comp.diff > 0 ? '+' : '';
      const diffFormatted = this.formatValue(comp.diff, col.field);
      diffDisplay = sign + diffFormatted;
      if (comp.pctDiff !== null) {
        const pctSign = comp.pctDiff > 0 ? '+' : '';
        diffDisplay += ` (${pctSign}${comp.pctDiff.toFixed(1)}%)`;
      }
      diffClass = comp.diff > 0 ? 'diff-up' : comp.diff < 0 ? 'diff-down' : 'diff-same';
    }

    const leftLabel = labels.left.length > 4 ? labels.left.substring(0, 4) + '..' : labels.left;
    const rightLabel = labels.right.length > 4 ? labels.right.substring(0, 4) + '..' : labels.right;

    return `<td class="${cellClass}${cellColorClass}"
                data-row-key="${row.key}"
                data-col-key="${col.colKeyObj.key}"
                data-value-index="${col.valueIndex}">
              <div class="comp-values">
                <div class="comp-val"><span class="comp-label comp-label-a" title="${labels.left}">${leftLabel}</span>${leftDisplay}</div>
                <div class="comp-val"><span class="comp-label comp-label-b" title="${labels.right}">${rightLabel}</span>${rightDisplay}</div>
              </div>
              <div class="comp-diff ${diffClass}">${diffDisplay}</div>
           </td>`;
  }

  buildDataColumns() {
    const { columns, values } = this.config;
    const result = this.aggregateResult;
    const combos = [];
    
    const allValues = result ? result.values : values.map((v, vIdx) => ({
      field: v.field,
      aggregation: v.aggregation,
      label: v.label || `${aggregationTypes[v.aggregation].label}(${v.field})`,
      isCalculated: false
    }));

    if (columns.length === 0) {
      allValues.forEach((v, vIdx) => {
        combos.push({
          colKeyObj: { key: '__total__' },
          valueIndex: vIdx,
          field: v.field
        });
      });
    } else {
      result.columnKeys.forEach(colKey => {
        allValues.forEach((v, vIdx) => {
          combos.push({
            colKeyObj: colKey,
            valueIndex: vIdx,
            field: v.field
          });
        });
      });
      
      allValues.forEach((v, vIdx) => {
        combos.push({
          colKeyObj: { key: '__total__', isTotal: true },
          valueIndex: vIdx,
          field: v.field
        });
      });
    }
    
    return combos;
  }

  renderRowHeaderCell(row) {
    let html = '';
    
    for (let i = 0; i < row.level; i++) {
      html += '<span class="row-indent"></span>';
    }
    
    if (row.hasChildren) {
      const expanded = this.isExpanded(row.key);
      html += `<span class="expand-btn" data-key="${row.key}">${expanded ? '▼' : '▶'}</span>`;
    } else if (!row.isSubtotal && !row.isGrandTotal) {
      html += '<span class="expand-btn" style="visibility: hidden;"></span>';
    }
    
    html += row.label;
    
    return html;
  }

  getCellValue(row, colKeyObj, valueIndex) {
    if (!this.aggregateResult) return '';
    
    let rowValues = [];
    if (!row.isGrandTotal) {
      const cleanKey = row.isSubtotal ? row.key.replace('__subtotal', '') : row.key;
      rowValues = cleanKey.split('||').filter(v => v);
    }
    
    let colValues = [];
    if (colKeyObj && !colKeyObj.isTotal && colKeyObj.key !== '__total__') {
      colValues = colKeyObj.values || [];
    }
    
    return getAggCellValue(this.aggregateResult, rowValues, colValues, valueIndex);
  }

  formatValue(value, field) {
    if (value === 'ERR') return 'ERR';
    if (value === '' || value === null || value === undefined) return '-';
    if (typeof value === 'number' && isNaN(value)) return '-';
    
    if (field === '利润率') {
      return (value * 100).toFixed(2) + '%';
    }
    
    if (typeof value === 'number') {
      if (Math.abs(value) >= 1000) {
        return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      }
      return value.toFixed(2);
    }
    
    return value;
  }

  computeValueStats() {
    this.valueStats = {};
    const allColCombos = this.buildDataColumns();
    const totalValueCount = this.aggregateResult ? this.aggregateResult.values.length : 0;
    
    for (let valueIndex = 0; valueIndex < totalValueCount; valueIndex++) {
      const allValues = [];
      const byColValues = {};
      
      this.allRows.forEach(row => {
        if (row.isSubtotal || row.isGrandTotal) return;
        
        allColCombos.forEach(col => {
          if (col.valueIndex !== valueIndex) return;
          
          const value = this.getCellValue(row, col.colKeyObj, valueIndex);
          if (typeof value === 'number' && !isNaN(value)) {
            allValues.push(value);
            
            const colKey = col.colKeyObj.key || '__total__';
            if (!byColValues[colKey]) {
              byColValues[colKey] = [];
            }
            byColValues[colKey].push(value);
          }
        });
      });
      
      if (allValues.length > 0) {
        const byColStats = {};
        Object.keys(byColValues).forEach(colKey => {
          const vals = byColValues[colKey];
          if (vals.length > 0) {
            byColStats[colKey] = {
              min: Math.min(...vals),
              max: Math.max(...vals)
            };
          }
        });
        
        this.valueStats[valueIndex] = {
          global: {
            min: Math.min(...allValues),
            max: Math.max(...allValues)
          },
          byColumn: byColStats
        };
      }
    }
  }

  applyConditionalFormat(value, valueIndex, colKey) {
    const styles = [];
    const rules = this.config.conditionalFormats?.[valueIndex] || [];
    
    if (rules.length === 0 || typeof value !== 'number' || isNaN(value)) {
      return { styles, dataBarWidth: 0 };
    }
    
    let dataBarWidth = 0;
    const valueStats = this.valueStats[valueIndex];
    
    rules.forEach(rule => {
      if (rule.type === 'threshold') {
        let match = false;
        switch (rule.operator) {
          case 'gt': match = value > rule.value; break;
          case 'gte': match = value >= rule.value; break;
          case 'lt': match = value < rule.value; break;
          case 'lte': match = value <= rule.value; break;
          case 'eq': match = value === rule.value; break;
        }
        if (match) {
          styles.push(`background-color: ${rule.color}`);
        }
      } else if (rule.type === 'dataBar') {
        if (valueStats) {
          const scope = rule.scope || 'column';
          let stats;
          
          if (scope === 'global') {
            stats = valueStats.global;
          } else {
            stats = valueStats.byColumn[colKey] || valueStats.global;
          }
          
          if (stats && stats.max !== stats.min) {
            const ratio = (value - stats.min) / (stats.max - stats.min);
            dataBarWidth = Math.max(0, Math.min(1, ratio)) * 100;
          }
        }
      } else if (rule.type === 'colorScale') {
        if (valueStats) {
          const scope = rule.scope || 'column';
          let stats;
          
          if (scope === 'global') {
            stats = valueStats.global;
          } else {
            stats = valueStats.byColumn[colKey] || valueStats.global;
          }
          
          if (stats && stats.max !== stats.min) {
            const ratio = (value - stats.min) / (stats.max - stats.min);
            const color = this.interpolateColor(rule.minColor, rule.maxColor, ratio);
            styles.push(`background-color: ${color}`);
          }
        }
      }
    });
    
    return { styles, dataBarWidth };
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
  }

  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const hex = Math.round(x).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }

  interpolateColor(color1, color2, ratio) {
    const c1 = this.hexToRgb(color1);
    const c2 = this.hexToRgb(color2);
    const r = c1.r + (c2.r - c1.r) * ratio;
    const g = c1.g + (c2.g - c1.g) * ratio;
    const b = c1.b + (c2.b - c1.b) * ratio;
    return this.rgbToHex(r, g, b);
  }

  renderVirtualScroll(columnHeaders) {
    const { rows, values } = this.config;
    const numRowHeaderCols = Math.max(rows.length, 1);
    
    const containerHeight = this.container.clientHeight || 400;
    const headerHeight = columnHeaders.length * HEADER_ROW_HEIGHT;
    const bodyHeight = containerHeight - headerHeight;
    
    const totalBodyRows = this.allRows.length;
    const totalBodyHeight = totalBodyRows * ROW_HEIGHT;
    
    const visibleRowCount = Math.ceil(bodyHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    const startIndex = Math.max(0, Math.floor(this.scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const endIndex = Math.min(totalBodyRows, startIndex + visibleRowCount);
    
    this.visibleRows = this.allRows.slice(startIndex, endIndex);
    
    let html = '<div style="position: relative; width: max-content; min-width: 100%;">';
    
    html += '<div style="position: sticky; top: 0; z-index: 20; background: white;">';
    html += '<table style="table-layout: fixed;">';
    html += '<thead>';
    
    columnHeaders.forEach((headerRow, levelIdx) => {
      html += '<tr>';
      if (levelIdx === columnHeaders.length - 1) {
        if (rows.length > 0) {
          rows.forEach(r => {
            html += `<th class="row-header corner">${r}</th>`;
          });
        } else {
          html += `<th class="row-header corner">项目</th>`;
        }
      } else {
        html += `<th class="row-header corner" colspan="${numRowHeaderCols}"></th>`;
      }
      headerRow.forEach(header => {
        if (levelIdx === columnHeaders.length - 1 && header.key) {
          const sortClass = this.sortColumnKey === header.key ? ' sorted' : '';
          html += `<th colspan="${header.colSpan}" class="sortable-header${sortClass}" data-sort-key="${header.key}">${header.label}${this.getSortArrow(header.key)}</th>`;
        } else {
          html += `<th colspan="${header.colSpan}">${header.label}</th>`;
        }
      });
      html += '</tr>';
    });
    
    html += '</thead></table></div>';
    
    html += `<div style="height: ${totalBodyHeight}px; position: relative;">`;
    html += `<div style="position: absolute; top: ${startIndex * ROW_HEIGHT}px; width: 100%;">`;
    html += '<table style="table-layout: fixed; width: 100%;"><tbody>';
    
    this.visibleRows.forEach(row => {
      html += this.renderRow(row);
    });
    
    html += '</tbody></table></div></div></div>';
    
    this.container.innerHTML = html;
    this.attachEventListeners();
    this._drawAllSparklines();
    
    if (!this.scrollHandlerAttached) {
      this.container.addEventListener('scroll', () => {
        this.scrollTop = this.container.scrollTop;
        if (this.allRows.length > VIRTUAL_THRESHOLD) {
          this.renderVirtualScroll(columnHeaders);
        }
      });
      this.scrollHandlerAttached = true;
    }
  }

  attachEventListeners() {
    this.container.querySelectorAll('.expand-btn[data-key]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        this.toggleExpand(key);
        if (this.onRowToggle) {
          this.onRowToggle(key, this.isExpanded(key));
        }
      };
    });
    
    this.container.querySelectorAll('.sortable-header[data-sort-key]').forEach(header => {
      header.onclick = (e) => {
        if (e.target.classList && (e.target.classList.contains('sort-arrow') || e.target.closest('.sort-arrow'))) {
          const sortKey = header.dataset.sortKey;
          this.toggleSort(sortKey);
        }
      };
    });
    
    this.container.querySelectorAll('.data-cell').forEach(cell => {
      cell.onclick = () => {
        this.highlightCell(cell);
      };
      
      cell.ondblclick = () => {
        if (this.onCellDoubleClick) {
          const rowKey = cell.dataset.rowKey;
          const colKey = cell.dataset.colKey;
          const valueIndex = parseInt(cell.dataset.valueIndex);
          this.onCellDoubleClick(rowKey, colKey, valueIndex);
        }
      };
    });

    this.attachRowHeaderClickListeners();
    this.attachColHeaderClickListeners();
    this.applySelectedHeaderStyle();
  }

  attachRowHeaderClickListeners() {
    this.container.querySelectorAll('td.row-header').forEach(cell => {
      cell.style.cursor = 'pointer';
      cell.onclick = (e) => {
        const target = e.target;
        if (target.nodeType === 1 && (target.classList.contains('expand-btn') || (target.closest && target.closest('.expand-btn')))) return;
        const row = cell.closest('tr');
        if (!row) return;

        const dataCell = row.querySelector('.data-cell');
        if (!dataCell) return;

        const rowKey = dataCell.dataset.rowKey;
        if (!rowKey || rowKey === '__grand_total__' || rowKey.endsWith('__subtotal')) return;

        if (this.selectedHeader && this.selectedHeader.type === 'row' && this.selectedHeader.key === rowKey) {
          this.selectedHeader = null;
        } else {
          this.selectedHeader = { type: 'row', key: rowKey };
        }

        this.applySelectedHeaderStyle();
        if (this.onHeaderSelect) {
          this.onHeaderSelect(this.selectedHeader);
        }
      };
    });
  }

  attachColHeaderClickListeners() {
    const columnHeaders = this.buildColumnHeaders();
    const numRowHeaderCols = this.config.rows.length;

    this.container.querySelectorAll('thead tr').forEach((tr, rowIdx) => {
      const headerRow = columnHeaders[rowIdx];
      if (!headerRow) return;

      let colOffset = 0;
      const ths = tr.querySelectorAll('th');
      let headerIdx = 0;

      ths.forEach((th, idx) => {
        const colspan = parseInt(th.getAttribute('colspan')) || 1;

        if (colOffset < numRowHeaderCols) {
          colOffset += colspan;
          return;
        }

        const currentHeaderIdx = headerIdx;
        headerIdx++;
        const header = headerRow[currentHeaderIdx];
        if (!header) return;

        if (rowIdx === columnHeaders.length - 1 && header.colKeyObj) {
          th.style.cursor = 'pointer';
          th.addEventListener('click', (e) => {
            if (e.target.classList && (e.target.classList.contains('sort-arrow') || e.target.closest('.sort-arrow'))) {
              return;
            }
            const colKey = header.colKeyObj.key;
            if (colKey === '__total__') return;

            if (this.selectedHeader && this.selectedHeader.type === 'col' && this.selectedHeader.key === colKey) {
              this.selectedHeader = null;
            } else {
              this.selectedHeader = { type: 'col', key: colKey, colKeyObj: header.colKeyObj, valueIndex: header.valueIndex };
            }

            this.applySelectedHeaderStyle();
            if (this.onHeaderSelect) {
              this.onHeaderSelect(this.selectedHeader);
            }
          });
        } else if (header.key && header.key !== '__total__') {
          th.style.cursor = 'pointer';
          th.addEventListener('click', () => {
            const colKey = header.key;

            if (this.selectedHeader && this.selectedHeader.type === 'col' && this.selectedHeader.key === colKey) {
              this.selectedHeader = null;
            } else {
              const colValues = colKey.split('||');
              const syntheticColKeyObj = {
                key: colKey,
                values: colValues,
                isTotal: false
              };
              this.selectedHeader = {
                type: 'col',
                key: colKey,
                colKeyObj: syntheticColKeyObj,
                isGroupSelection: true,
                dimLevel: header.dimLevel
              };
            }

            this.applySelectedHeaderStyle();
            if (this.onHeaderSelect) {
              this.onHeaderSelect(this.selectedHeader);
            }
          });
        }
      });
    });
  }

  findMatchingColKeyObj(targetKey) {
    const allColCombos = this.buildDataColumns();
    return allColCombos.find(c => c.colKeyObj && c.colKeyObj.key === targetKey);
  }

  applySelectedHeaderStyle() {
    this.container.querySelectorAll('.header-selected').forEach(el => {
      el.classList.remove('header-selected');
    });

    if (!this.selectedHeader) return;

    if (this.selectedHeader.type === 'row') {
      this.container.querySelectorAll('td.row-header').forEach(cell => {
        const row = cell.closest('tr');
        if (!row) return;
        const dataCell = row.querySelector('.data-cell');
        if (dataCell && dataCell.dataset.rowKey === this.selectedHeader.key) {
          cell.classList.add('header-selected');
        }
      });
    } else if (this.selectedHeader.type === 'col') {
      const selKey = this.selectedHeader.key;
      const columnHeaders = this.buildColumnHeaders();
      const numRowHeaderCols = this.config.rows.length;

      this.container.querySelectorAll('thead tr').forEach((tr, rowIdx) => {
        const headerRow = columnHeaders[rowIdx];
        if (!headerRow) return;

        let colOffset = 0;
        let headerIdx = 0;

        tr.querySelectorAll('th').forEach((th) => {
          const colspan = parseInt(th.getAttribute('colspan')) || 1;

          if (colOffset < numRowHeaderCols) {
            colOffset += colspan;
            return;
          }

          const header = headerRow[headerIdx];
          headerIdx++;

          if (!header) return;

          if (header.colKeyObj && header.colKeyObj.key === selKey) {
            th.classList.add('header-selected');
          } else if (header.key === selKey) {
            th.classList.add('header-selected');
          } else if (this.selectedHeader.isGroupSelection && header.key && header.key !== '__total__' && selKey.startsWith(header.key + '||') === false && header.key.startsWith(selKey + '||')) {
            th.classList.add('header-selected');
          } else if (this.selectedHeader.isGroupSelection && header.key && header.key !== '__total__' && header.key.startsWith(selKey)) {
            th.classList.add('header-selected');
          }
        });
      });

      this.container.querySelectorAll('.data-cell').forEach(cell => {
        const cellColKey = cell.dataset.colKey;
        if (cellColKey === selKey) {
          cell.classList.add('header-selected');
        } else if (this.selectedHeader.isGroupSelection && cellColKey && cellColKey.startsWith(selKey)) {
          cell.classList.add('header-selected');
        }
      });
    }
  }

  getChartData() {
    if (!this.selectedHeader || !this.aggregateResult) return null;

    const allColCombos = this.buildDataColumns();
    const allValues = this.aggregateResult.values;

    if (this.selectedHeader.type === 'row') {
      const rowKey = this.selectedHeader.key;
      const rowObj = this.allRows.find(r => r.key === rowKey);
      if (!rowObj) return null;

      const labels = [];
      const seenLabels = new Set();
      allColCombos.forEach(col => {
        const colKey = col.colKeyObj.key;
        if (colKey === '__total__') return;
        const colValues = col.colKeyObj.values || [];
        const label = colValues.join(' / ');
        if (!seenLabels.has(colKey)) {
          seenLabels.add(colKey);
          labels.push({ key: colKey, label });
        }
      });

      if (labels.length === 0) {
        labels.push({ key: '__total__', label: '总计' });
      }

      const series = allValues.map((v, vIdx) => {
        const vals = labels.map(l => {
          const colObj = l.key === '__total__'
            ? { key: '__total__', isTotal: true, values: [] }
            : allColCombos.find(c => c.colKeyObj.key === l.key && c.valueIndex === vIdx)?.colKeyObj;
          if (!colObj) return 0;
          const val = this.getCellValue(rowObj, colObj, vIdx);
          return (typeof val === 'number' && !isNaN(val)) ? val : 0;
        });
        return { name: v.label, values: vals };
      });

      return {
        labels: labels.map(l => l.label),
        series,
        title: `行: ${rowObj.label}`
      };

    } else if (this.selectedHeader.type === 'col') {
      const colKeyObj = this.selectedHeader.colKeyObj;
      if (!colKeyObj) return null;

      const dataRows = this.allRows.filter(r => !r.isSubtotal && !r.isGrandTotal);
      const labels = dataRows.map(r => r.label);

      const series = allValues.map((v, vIdx) => {
        const vals = dataRows.map(r => {
          const val = this.getCellValue(r, colKeyObj, vIdx);
          return (typeof val === 'number' && !isNaN(val)) ? val : 0;
        });
        return { name: v.label, values: vals };
      });

      const titleParts = colKeyObj.values || [];
      if (this.selectedHeader.isGroupSelection && titleParts.length < this.config.columns.length) {
        const dimNames = this.config.columns.slice(0, titleParts.length).map((c, i) => `${c}: ${titleParts[i]}`);
        return { labels, series, title: `列: ${dimNames.join(' / ')}` };
      }

      return {
        labels,
        series,
        title: `列: ${titleParts.join(' / ')}`
      };
    }

    return null;
  }

  highlightCell(cell) {
    this.container.querySelectorAll('.highlighted').forEach(c => {
      c.classList.remove('highlighted');
    });
    
    cell.classList.add('highlighted');
    this.highlightedCell = cell;
    
    const row = cell.closest('tr');
    if (row) {
      row.querySelectorAll('.row-header').forEach(header => {
        header.classList.add('highlighted');
      });
    }
    
    const cellIndex = Array.from(cell.parentNode.children).indexOf(cell);
    if (cellIndex >= 0) {
      this.container.querySelectorAll('thead tr').forEach(headerRow => {
        const headers = headerRow.querySelectorAll('th');
        if (headers[cellIndex]) {
          headers[cellIndex].classList.add('highlighted');
        }
      });
    }
  }
}
