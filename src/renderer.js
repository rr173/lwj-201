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
    const { columns, values } = this.config;
    const result = this.aggregateResult;
    
    if (!result) return [];
    
    const headers = [];
    
    if (columns.length === 0) {
      const row = [];
      values.forEach((v, vIdx) => {
        const colKeyObj = { key: '__total__' };
        row.push({
          label: v.label || `${aggregationTypes[v.aggregation].label}(${v.field})`,
          colSpan: 1,
          key: `${colKeyObj.key}__${vIdx}`,
          valueIndex: vIdx,
          colKeyObj
        });
      });
      headers.push(row);
    } else {
      const allColCombos = [];
      result.columnKeys.forEach(colKey => {
        values.forEach((v, vIdx) => {
          allColCombos.push({
            colKey,
            valueConfig: v,
            valueIndex: vIdx
          });
        });
      });
      
      values.forEach((v, vIdx) => {
        allColCombos.push({
          colKey: { key: '__total__', values: [], isTotal: true },
          valueConfig: v,
          valueIndex: vIdx
        });
      });
      
      for (let level = 0; level < columns.length; level++) {
        const levelHeaders = [];
        let lastKey = null;
        let lastLabel = null;
        let spanCount = 0;
        
        allColCombos.forEach((combo, idx) => {
          const val = combo.colKey.values ? combo.colKey.values[level] : null;
          const key = val || (combo.colKey.isTotal ? '__total__' : null);
          const label = val || (combo.colKey.isTotal ? '总计' : '');
          
          if (key !== lastKey) {
            if (lastKey !== null) {
              levelHeaders.push({ label: lastLabel, colSpan: spanCount, key: lastKey });
            }
            lastKey = key;
            lastLabel = label;
            spanCount = 1;
          } else {
            spanCount++;
          }
          
          if (idx === allColCombos.length - 1) {
            levelHeaders.push({ label: lastLabel, colSpan: spanCount, key: lastKey });
          }
        });
        
        headers.push(levelHeaders);
      }
      
      const lastLevel = [];
      allColCombos.forEach(combo => {
        lastLevel.push({
          label: combo.valueConfig.label || `${aggregationTypes[combo.valueConfig.aggregation].label}(${combo.valueConfig.field})`,
          colSpan: 1,
          colKeyObj: combo.colKey,
          valueIndex: combo.valueIndex,
          key: `${combo.colKey.key}__${combo.valueIndex}`
        });
      });
      headers.push(lastLevel);
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
    allColCombos.forEach(col => {
      const value = this.getCellValue(row, col.colKeyObj, col.valueIndex);
      const displayValue = this.formatValue(value, col.field);
      
      let cellClass = 'data-cell';
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
    });
    
    html += '</tr>';
    return html;
  }

  buildDataColumns() {
    const { columns, values } = this.config;
    const result = this.aggregateResult;
    const combos = [];
    
    if (columns.length === 0) {
      values.forEach((v, vIdx) => {
        combos.push({
          colKeyObj: { key: '__total__' },
          valueIndex: vIdx,
          field: v.field
        });
      });
    } else {
      result.columnKeys.forEach(colKey => {
        values.forEach((v, vIdx) => {
          combos.push({
            colKeyObj: colKey,
            valueIndex: vIdx,
            field: v.field
          });
        });
      });
      
      values.forEach((v, vIdx) => {
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
    if (value === '' || value === null || value === undefined || value === NaN) return '-';
    
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
    const { values } = this.config;
    const allColCombos = this.buildDataColumns();
    
    values.forEach((_, valueIndex) => {
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
    });
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
              const matchingCol = this.findMatchingColKeyObj(colKey);
              if (matchingCol) {
                this.selectedHeader = { type: 'col', key: matchingCol.colKeyObj.key, colKeyObj: matchingCol.colKeyObj, valueIndex: matchingCol.valueIndex };
              }
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

          if (header && ((header.colKeyObj && header.colKeyObj.key === this.selectedHeader.key) || header.key === this.selectedHeader.key)) {
            th.classList.add('header-selected');
          }
        });
      });

      this.container.querySelectorAll('.data-cell').forEach(cell => {
        if (cell.dataset.colKey === this.selectedHeader.key) {
          cell.classList.add('header-selected');
        }
      });
    }
  }

  getChartData() {
    if (!this.selectedHeader || !this.aggregateResult) return null;

    const allColCombos = this.buildDataColumns();
    const { values } = this.config;

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

      const series = values.map((v, vIdx) => {
        const vals = labels.map(l => {
          const colObj = l.key === '__total__'
            ? { key: '__total__', isTotal: true, values: [] }
            : allColCombos.find(c => c.colKeyObj.key === l.key && c.valueIndex === vIdx)?.colKeyObj;
          if (!colObj) return 0;
          return this.getCellValue(rowObj, colObj, vIdx) || 0;
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

      const series = values.map((v, vIdx) => {
        const vals = dataRows.map(r => {
          return this.getCellValue(r, colKeyObj, vIdx) || 0;
        });
        return { name: v.label, values: vals };
      });

      return {
        labels,
        series,
        title: `列: ${(colKeyObj.values || []).join(' / ')}`
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
