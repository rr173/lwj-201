import { salesData, fields } from './data.js';
import { PivotRenderer } from './renderer.js';
import { aggregationTypes, getDistinctValues, getDetailRecords } from './aggregator.js';
import { ChartEngine } from './chart-engine.js';
import { SnapshotEngine } from './snapshot-engine.js';

class PivotApp {
  constructor() {
    this.rawData = salesData;
    this.fields = fields;
    this.config = {
      rows: ['地区', '产品类别'],
      columns: ['客户等级'],
      values: [
        { field: '销售额', aggregation: 'sum', label: '求和(销售额)' },
        { field: '数量', aggregation: 'sum', label: '求和(数量)' }
      ],
      filters: [],
      conditionalFormats: {}
    };
    
    this.renderer = null;
    this.chartEngine = null;
    this.snapshotEngine = new SnapshotEngine();
    this.configLocked = false;
    this.draggedField = null;
    this.draggedZoneField = null;
    this.snapshotCounter = 1;
    
    this.init();
  }
  
  init() {
    this.renderer = new PivotRenderer(
      document.getElementById('pivotTable'),
      this.rawData
    );
    
    this.renderer.snapshotEngine = this.snapshotEngine;
    
    this.chartEngine = new ChartEngine(
      document.getElementById('chartCanvasWrapper')
    );
    
    this.renderer.onCellDoubleClick = (rowKey, colKey, valueIndex) => {
      this.showDetailModal(rowKey, colKey, valueIndex);
    };

    this.renderer.onHeaderSelect = (selectedHeader) => {
      this.onHeaderSelect(selectedHeader);
    };

    this.setupChartTypeButtons();
    
    this.renderFieldList();
    this.renderZones();
    this.setupDropZones();
    this.setupModal();
    this.initSnapshotPanel();
    this.updateRecordCount();
    this.renderPivot();
  }
  
  updateRecordCount() {
    document.getElementById('recordCount').textContent = 
      `共 ${this.rawData.length.toLocaleString()} 条记录`;
  }
  
  renderFieldList() {
    const fieldList = document.getElementById('fieldList');
    fieldList.innerHTML = '';
    
    this.fields.forEach(field => {
      const el = document.createElement('div');
      el.className = `field-item ${field.type}`;
      el.textContent = field.label;
      el.draggable = true;
      el.dataset.field = field.key;
      el.dataset.type = field.type;
      
      el.addEventListener('dragstart', (e) => {
        if (this.configLocked) {
          e.preventDefault();
          return;
        }
        this.draggedField = field;
        e.dataTransfer.effectAllowed = 'copy';
      });
      
      el.addEventListener('dragend', () => {
        this.draggedField = null;
      });
      
      fieldList.appendChild(el);
    });
  }
  
  setupDropZones() {
    const zones = document.querySelectorAll('.zone-content');
    
    zones.forEach(zone => {
      const zoneType = zone.dataset.zone;
      
      zone.parentNode.addEventListener('dragover', (e) => {
        if (this.configLocked) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        zone.parentNode.classList.add('drag-over');
      });
      
      zone.parentNode.addEventListener('dragleave', () => {
        zone.parentNode.classList.remove('drag-over');
      });
      
      zone.parentNode.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.parentNode.classList.remove('drag-over');

        if (this.configLocked) {
          this.draggedZoneField = null;
          this.draggedField = null;
          return;
        }
        
        if (this.draggedZoneField) {
          this.handleZoneFieldDrop(zoneType, this.draggedZoneField);
          this.draggedZoneField = null;
        } else if (this.draggedField) {
          this.handleFieldDrop(zoneType, this.draggedField);
        }
      });
    });
  }
  
  handleFieldDrop(zoneType, field) {
    if (this.configLocked) return;

    if (zoneType === 'values') {
      if (field.type !== 'measure') {
        alert('值区域只能放置数值字段');
        return;
      }
      
      const valueConfig = {
        field: field.key,
        aggregation: 'sum',
        label: `${aggregationTypes.sum.label}(${field.label})`
      };
      
      this.config.values.push(valueConfig);
    } else {
      if (zoneType === 'filter') {
        if (!this.config.filters.find(f => f.field === field.key)) {
          this.config.filters.push({
            field: field.key,
            label: field.label,
            values: []
          });
        }
      } else {
        const targetArr = zoneType === 'rows' ? this.config.rows : this.config.columns;
        if (!targetArr.includes(field.key)) {
          targetArr.push(field.key);
          
          const otherArr = zoneType === 'rows' ? this.config.columns : this.config.rows;
          const idx = otherArr.indexOf(field.key);
          if (idx > -1) {
            otherArr.splice(idx, 1);
          }
        }
      }
    }
    
    this.renderZones();
    this.renderPivot();
  }
  
  handleZoneFieldDrop(targetZone, zoneField) {
    if (this.configLocked) return;

    const { field, sourceZone, index } = zoneField;
    
    if (sourceZone === targetZone) return;
    
    if (sourceZone === 'values') {
      this.config.values.splice(index, 1);
    } else if (sourceZone === 'filter') {
      this.config.filters.splice(index, 1);
    } else {
      const sourceArr = sourceZone === 'rows' ? this.config.rows : this.config.columns;
      sourceArr.splice(index, 1);
    }
    
    const dummyField = { key: field, label: field, type: this.fields.find(f => f.key === field)?.type || 'dimension' };
    this.handleFieldDrop(targetZone, dummyField);
  }
  
  renderZones() {
    this.renderZone('rows', this.config.rows, 'rows');
    this.renderZone('columns', this.config.columns, 'columns');
    this.renderValuesZone();
    this.renderFiltersZone();
  }
  
  renderZone(zoneId, items, zoneType) {
    const zone = document.querySelector(`#${zoneId}Zone .zone-content`);
    zone.innerHTML = '';
    
    items.forEach((fieldKey, index) => {
      const field = this.fields.find(f => f.key === fieldKey);
      if (!field) return;
      
      const el = this.createZoneField(field.label, zoneType, {
        field: fieldKey,
        sourceZone: zoneType,
        index
      });
      
      zone.appendChild(el);
    });
  }
  
  renderValuesZone() {
    const zone = document.querySelector('#valuesZone .zone-content');
    zone.innerHTML = '';
    
    this.config.values.forEach((valueConfig, index) => {
      const el = this.createZoneField(valueConfig.label, 'values', {
        field: valueConfig.field,
        sourceZone: 'values',
        index,
        valueConfig
      });
      
      el.addEventListener('click', (e) => {
        if (this.configLocked) return;
        if (e.target.classList.contains('cf-btn')) {
          e.stopPropagation();
          this.showConditionalFormatModal(index);
        } else if (!e.target.classList.contains('remove-btn')) {
          this.showAggregationModal(index);
        }
      });
      
      zone.appendChild(el);
    });
  }
  
  renderFiltersZone() {
    const zone = document.querySelector('#filterZone .zone-content');
    zone.innerHTML = '';
    
    this.config.filters.forEach((filterConfig, index) => {
      const el = this.createZoneField(filterConfig.label, 'filter', {
        field: filterConfig.field,
        sourceZone: 'filter',
        index,
        filterConfig
      });
      
      el.addEventListener('click', (e) => {
        if (this.configLocked) return;
        if (!e.target.classList.contains('remove-btn')) {
          this.showFilterModal(index);
        }
      });
      
      zone.appendChild(el);
    });
  }
  
  createZoneField(label, zoneType, data) {
    const el = document.createElement('div');
    el.className = `zone-field ${zoneType}`;
    el.draggable = true;
    
    const hasCF = zoneType === 'values' && this.config.conditionalFormats[data.index] && 
      this.config.conditionalFormats[data.index].length > 0;
    const cfBtnClass = hasCF ? 'cf-btn has-cf' : 'cf-btn';
    const cfBtn = zoneType === 'values' ? `<button class="${cfBtnClass}" title="条件格式">🎨</button>` : '';
    
    el.innerHTML = `
      <span>${label}</span>
      ${cfBtn}
      <button class="remove-btn" title="移除">&times;</button>
    `;
    
    el.addEventListener('dragstart', (e) => {
      if (this.configLocked) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      this.draggedZoneField = data;
      e.dataTransfer.effectAllowed = 'move';
    });
    
    el.addEventListener('dragend', () => {
      this.draggedZoneField = null;
    });
    
    const removeBtn = el.querySelector('.remove-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeZoneField(data);
    });
    
    return el;
  }
  
  removeZoneField(data) {
    if (this.configLocked) return;

    const { sourceZone, index } = data;
    
    if (sourceZone === 'values') {
      this.config.values.splice(index, 1);
      this.rebuildConditionalFormats(index);
    } else if (sourceZone === 'filter') {
      this.config.filters.splice(index, 1);
    } else {
      const arr = sourceZone === 'rows' ? this.config.rows : this.config.columns;
      arr.splice(index, 1);
    }
    
    this.renderZones();
    this.renderPivot();
  }
  
  rebuildConditionalFormats(removedIndex) {
    const newCF = {};
    const oldCF = this.config.conditionalFormats;
    
    Object.keys(oldCF).forEach(oldIdxStr => {
      const oldIdx = parseInt(oldIdxStr);
      if (oldIdx < removedIndex) {
        newCF[oldIdx] = oldCF[oldIdx];
      } else if (oldIdx > removedIndex) {
        newCF[oldIdx - 1] = oldCF[oldIdx];
      }
    });
    
    this.config.conditionalFormats = newCF;
  }
  
  renderPivot() {
    this.renderer.updateConfig(this.config);
    this.refreshChartIfSelected();
  }

  setupChartTypeButtons() {
    document.querySelectorAll('.chart-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.chartEngine.setChartType(type);
      });
    });
  }

  onHeaderSelect(selectedHeader) {
    if (!selectedHeader) {
      this.chartEngine.clear();
      document.getElementById('chartTitle').textContent = '图表可视化';
      return;
    }

    const data = this.renderer.getChartData();
    if (!data) {
      this.chartEngine.clear();
      return;
    }

    document.getElementById('chartTitle').textContent = data.title;
    this.chartEngine.setData(data, this.chartEngine.chartType);
  }

  refreshChartIfSelected() {
    const sel = this.renderer.selectedHeader;
    if (!sel) return;

    if (sel.type === 'row') {
      const exists = this.renderer.allRows.find(r => r.key === sel.key);
      if (!exists) {
        this.renderer.selectedHeader = null;
        this.chartEngine.clear();
        document.getElementById('chartTitle').textContent = '图表可视化';
        return;
      }
    } else if (sel.type === 'col') {
      const allColCombos = this.renderer.buildDataColumns();
      let exists;
      if (sel.isGroupSelection) {
        exists = allColCombos.find(c => c.colKeyObj && c.colKeyObj.key && c.colKeyObj.key.startsWith(sel.key));
      } else {
        exists = allColCombos.find(c => c.colKeyObj && c.colKeyObj.key === sel.key);
      }
      if (!exists) {
        this.renderer.selectedHeader = null;
        this.chartEngine.clear();
        document.getElementById('chartTitle').textContent = '图表可视化';
        return;
      }
    }

    const data = this.renderer.getChartData();
    if (data) {
      document.getElementById('chartTitle').textContent = data.title;
      this.chartEngine.setData(data, this.chartEngine.chartType);
    }
  }
  
  showConditionalFormatModal(valueIndex) {
    const valueConfig = this.config.values[valueIndex];
    const field = this.fields.find(f => f.key === valueConfig.field);
    const rules = this.config.conditionalFormats[valueIndex] || [];
    
    let html = `
      <div class="cf-header">
        <div class="cf-type-selector">
          <label class="cf-type-label">
            <input type="radio" name="cfType" value="threshold" ${!rules.some(r => r.type === 'dataBar' || r.type === 'colorScale') ? 'checked' : ''}>
            <span>阈值着色</span>
          </label>
          <label class="cf-type-label">
            <input type="radio" name="cfType" value="dataBar" ${rules.some(r => r.type === 'dataBar') ? 'checked' : ''}>
            <span>数据条</span>
          </label>
          <label class="cf-type-label">
            <input type="radio" name="cfType" value="colorScale" ${rules.some(r => r.type === 'colorScale') ? 'checked' : ''}>
            <span>色阶</span>
          </label>
        </div>
      </div>
      
      <div class="cf-content" id="cfContent">
      </div>
      
      <div class="filter-actions">
        <button class="btn btn-primary" id="saveCF">确定</button>
        <button class="btn btn-default" id="cancelCF">取消</button>
      </div>
    `;
    
    this.showModal(`条件格式 - ${field.label}`, html);
    
    const renderThresholdPanel = () => {
      const thresholdRules = rules.filter(r => r.type === 'threshold');
      let content = '<div class="threshold-rules">';
      
      thresholdRules.forEach((rule, idx) => {
        content += this.renderThresholdRule(rule, idx);
      });
      
      content += '</div>';
      content += '<button class="btn btn-default add-rule-btn" id="addThresholdRule">+ 添加规则</button>';
      return content;
    };
    
    const renderDataBarPanel = () => {
      const dataBarRule = rules.find(r => r.type === 'dataBar');
      const color = dataBarRule?.color || '#667eea';
      const scope = dataBarRule?.scope || 'column';
      return `
        <div class="cf-panel">
          <div class="cf-form-row">
            <label>数据条颜色:</label>
            <input type="color" id="dataBarColor" value="${color}">
          </div>
          <div class="cf-form-row">
            <label>计算范围:</label>
            <select id="dataBarScope">
              <option value="column" ${scope === 'column' ? 'selected' : ''}>按列单独计算</option>
              <option value="global" ${scope === 'global' ? 'selected' : ''}>全局统一计算</option>
            </select>
          </div>
          <div class="cf-hint">按列计算：每列单独计算最小/最大值，适合列内比较；全局计算：所有列共用最小/最大值，适合跨列比较</div>
        </div>
      `;
    };
    
    const renderColorScalePanel = () => {
      const colorScaleRule = rules.find(r => r.type === 'colorScale');
      const minColor = colorScaleRule?.minColor || '#f8696b';
      const maxColor = colorScaleRule?.maxColor || '#63be7b';
      const scope = colorScaleRule?.scope || 'column';
      return `
        <div class="cf-panel">
          <div class="cf-form-row">
            <label>最小值颜色:</label>
            <input type="color" id="colorScaleMin" value="${minColor}">
          </div>
          <div class="cf-form-row">
            <label>最大值颜色:</label>
            <input type="color" id="colorScaleMax" value="${maxColor}">
          </div>
          <div class="cf-form-row">
            <label>计算范围:</label>
            <select id="colorScaleScope">
              <option value="column" ${scope === 'column' ? 'selected' : ''}>按列单独计算</option>
              <option value="global" ${scope === 'global' ? 'selected' : ''}>全局统一计算</option>
            </select>
          </div>
          <div class="cf-hint">按列计算：每列单独计算最小/最大值，适合列内比较；全局计算：所有列共用最小/最大值，适合跨列比较</div>
        </div>
      `;
    };
    
    const updateCFContent = () => {
      const type = document.querySelector('input[name="cfType"]:checked').value;
      const contentEl = document.getElementById('cfContent');
      
      if (type === 'threshold') {
        contentEl.innerHTML = renderThresholdPanel();
        this.setupThresholdEvents();
      } else if (type === 'dataBar') {
        contentEl.innerHTML = renderDataBarPanel();
      } else if (type === 'colorScale') {
        contentEl.innerHTML = renderColorScalePanel();
      }
    };
    
    document.querySelectorAll('input[name="cfType"]').forEach(radio => {
      radio.addEventListener('change', updateCFContent);
    });
    
    updateCFContent();
    
    document.getElementById('saveCF').addEventListener('click', () => {
      const type = document.querySelector('input[name="cfType"]:checked').value;
      const newRules = [];
      
      if (type === 'threshold') {
        const ruleEls = document.querySelectorAll('.threshold-rule');
        ruleEls.forEach(ruleEl => {
          const operator = ruleEl.querySelector('.threshold-operator').value;
          const value = parseFloat(ruleEl.querySelector('.threshold-value').value);
          const color = ruleEl.querySelector('.threshold-color').value;
          
          if (!isNaN(value)) {
            newRules.push({
              type: 'threshold',
              operator,
              value,
              color
            });
          }
        });
      } else if (type === 'dataBar') {
        const color = document.getElementById('dataBarColor').value;
        const scope = document.getElementById('dataBarScope').value;
        newRules.push({
          type: 'dataBar',
          color,
          scope
        });
      } else if (type === 'colorScale') {
        const minColor = document.getElementById('colorScaleMin').value;
        const maxColor = document.getElementById('colorScaleMax').value;
        const scope = document.getElementById('colorScaleScope').value;
        newRules.push({
          type: 'colorScale',
          minColor,
          maxColor,
          scope
        });
      }
      
      this.config.conditionalFormats[valueIndex] = newRules;
      this.renderZones();
      this.renderPivot();
      this.hideModal();
    });
    
    document.getElementById('cancelCF').addEventListener('click', () => {
      this.hideModal();
    });
  }
  
  renderThresholdRule(rule, index) {
    const operators = [
      { value: 'gt', label: '大于' },
      { value: 'gte', label: '大于等于' },
      { value: 'lt', label: '小于' },
      { value: 'lte', label: '小于等于' },
      { value: 'eq', label: '等于' }
    ];
    
    return `
      <div class="threshold-rule" data-index="${index}">
        <select class="threshold-operator">
          ${operators.map(op => `<option value="${op.value}" ${rule.operator === op.value ? 'selected' : ''}>${op.label}</option>`).join('')}
        </select>
        <input type="number" class="threshold-value" value="${rule.value ?? ''}" placeholder="数值">
        <input type="color" class="threshold-color" value="${rule.color || '#ffeb3b'}">
        <button class="btn btn-default remove-threshold-btn" data-index="${index}">删除</button>
      </div>
    `;
  }
  
  setupThresholdEvents() {
    const addBtn = document.getElementById('addThresholdRule');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const container = document.querySelector('.threshold-rules');
        const newRule = { type: 'threshold', operator: 'gt', value: 0, color: '#ffeb3b' };
        const ruleHtml = this.renderThresholdRule(newRule, container.children.length);
        container.insertAdjacentHTML('beforeend', ruleHtml);
        this.setupThresholdRuleEvents();
      });
    }
    this.setupThresholdRuleEvents();
  }
  
  setupThresholdRuleEvents() {
    document.querySelectorAll('.remove-threshold-btn').forEach(btn => {
      btn.onclick = () => {
        btn.closest('.threshold-rule').remove();
      };
    });
  }
  
  setupModal() {
    const modal = document.getElementById('modal');
    const closeBtn = document.getElementById('closeModal');
    
    closeBtn.addEventListener('click', () => {
      this.hideModal();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.hideModal();
      }
    });
  }
  
  showModal(title, content) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('modal').classList.remove('hidden');
  }
  
  hideModal() {
    document.getElementById('modal').classList.add('hidden');
  }
  
  showAggregationModal(valueIndex) {
    const valueConfig = this.config.values[valueIndex];
    const field = this.fields.find(f => f.key === valueConfig.field);
    
    let optionsHtml = '<div class="aggregation-options">';
    
    Object.entries(aggregationTypes).forEach(([key, agg]) => {
      const checked = valueConfig.aggregation === key ? 'checked' : '';
      optionsHtml += `
        <label>
          <input type="radio" name="aggregation" value="${key}" ${checked}>
          <span>${agg.label}</span>
        </label>
      `;
    });
    
    optionsHtml += '</div>';
    optionsHtml += `
      <div class="filter-actions">
        <button class="btn btn-primary" id="saveAggregation">确定</button>
        <button class="btn btn-default" id="cancelAggregation">取消</button>
      </div>
    `;
    
    this.showModal(`设置 ${field.label} 的聚合方式`, optionsHtml);
    
    document.getElementById('saveAggregation').addEventListener('click', () => {
      const selected = document.querySelector('input[name="aggregation"]:checked').value;
      valueConfig.aggregation = selected;
      valueConfig.label = `${aggregationTypes[selected].label}(${field.label})`;
      
      this.renderZones();
      this.renderPivot();
      this.hideModal();
    });
    
    document.getElementById('cancelAggregation').addEventListener('click', () => {
      this.hideModal();
    });
  }
  
  showFilterModal(filterIndex) {
    const filterConfig = this.config.filters[filterIndex];
    const allValues = getDistinctValues(this.rawData, filterConfig.field);
    
    let filterHtml = '<div class="filter-list">';
    
    allValues.forEach(value => {
      const checked = filterConfig.values.includes(value) ? 'checked' : '';
      filterHtml += `
        <label class="filter-item">
          <input type="checkbox" value="${value}" ${checked}>
          <span>${value}</span>
        </label>
      `;
    });
    
    filterHtml += '</div>';
    filterHtml += `
      <div class="filter-actions">
        <button class="btn btn-default" id="selectAllFilter">全选</button>
        <button class="btn btn-default" id="clearAllFilter">清空</button>
        <button class="btn btn-primary" id="saveFilter">确定</button>
        <button class="btn btn-default" id="cancelFilter">取消</button>
      </div>
    `;
    
    this.showModal(`筛选 ${filterConfig.label}`, filterHtml);
    
    document.getElementById('selectAllFilter').addEventListener('click', () => {
      document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
      });
    });
    
    document.getElementById('clearAllFilter').addEventListener('click', () => {
      document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
    });
    
    document.getElementById('saveFilter').addEventListener('click', () => {
      const checked = [];
      document.querySelectorAll('.filter-item input[type="checkbox"]:checked').forEach(cb => {
        checked.push(cb.value);
      });
      
      filterConfig.values = checked;
      this.renderZones();
      this.renderPivot();
      this.hideModal();
    });
    
    document.getElementById('cancelFilter').addEventListener('click', () => {
      this.hideModal();
    });
  }
  
  showDetailModal(rowKey, colKey, valueIndex) {
    const rowKeyObj = this.parseKey(rowKey);
    const colKeyObj = this.parseKey(colKey);
    
    const detailConfig = {
      rows: this.config.rows,
      columns: this.config.columns,
      filters: this.config.filters
    };
    
    const records = getDetailRecords(this.rawData, detailConfig, rowKeyObj, colKeyObj);
    
    let title = '明细数据';
    if (rowKeyObj && rowKeyObj.values && rowKeyObj.values.length > 0) {
      title = `明细 - ${rowKeyObj.values.join(' / ')}`;
    }
    
    let tableHtml = `
      <p>共 ${records.length} 条记录</p>
      <table class="detail-table">
        <thead>
          <tr>
    `;
    
    this.fields.forEach(field => {
      tableHtml += `<th>${field.label}</th>`;
    });
    
    tableHtml += `
          </tr>
        </thead>
        <tbody>
    `;
    
    records.slice(0, 100).forEach(record => {
      tableHtml += '<tr>';
      this.fields.forEach(field => {
        let value = record[field.key];
        if (field.key === '利润率') {
          value = (value * 100).toFixed(2) + '%';
        } else if (typeof value === 'number') {
          value = value.toLocaleString();
        }
        tableHtml += `<td>${value}</td>`;
      });
      tableHtml += '</tr>';
    });
    
    tableHtml += '</tbody></table>';
    
    if (records.length > 100) {
      tableHtml += `<p style="margin-top: 10px; color: #999;">显示前 100 条，共 ${records.length} 条</p>`;
    }
    
    this.showModal(title, tableHtml);
  }
  
  parseKey(keyStr) {
    if (!keyStr || keyStr === '__total__' || keyStr === '__grand_total__') {
      return { key: '__total__', values: [], isTotal: true };
    }
    
    const cleanKey = keyStr.replace('__subtotal', '');
    const values = cleanKey.split('||').filter(v => v);
    
    return {
      key: cleanKey,
      values,
      isTotal: false
    };
  }

  initSnapshotPanel() {
    document.getElementById('saveSnapshotBtn').addEventListener('click', () => {
      this.saveSnapshot();
    });

    document.getElementById('startCompareBtn').addEventListener('click', () => {
      this.startComparison();
    });

    document.getElementById('exitCompareBtn').addEventListener('click', () => {
      this.exitComparison();
    });

    document.getElementById('exitCompareBannerBtn').addEventListener('click', () => {
      this.exitComparison();
    });

    const leftSel = document.getElementById('compareLeft');
    const rightSel = document.getElementById('compareRight');

    const updateBtn = () => {
      const left = leftSel.value;
      const right = rightSel.value;
      document.getElementById('startCompareBtn').disabled = !left || !right || left === right;
    };

    leftSel.addEventListener('change', updateBtn);
    rightSel.addEventListener('change', updateBtn);
  }

  saveSnapshot() {
    if (this.config.values.length === 0) {
      alert('请先配置值区域再保存快照');
      return;
    }

    const result = this.snapshotEngine.saveSnapshot(
      `快照 ${this.snapshotCounter}`,
      this.config,
      this.renderer
    );

    if (!result.success) {
      alert(result.message);
      return;
    }

    this.snapshotCounter++;
    this.renderSnapshotList();
    this.updateCompareSelectors();
  }

  deleteSnapshot(id) {
    this.snapshotEngine.deleteSnapshot(id);
    this.renderSnapshotList();
    this.updateCompareSelectors();

    if (this.snapshotEngine.comparisonMode) {
      this.exitComparison();
    }
  }

  renameSnapshot(id) {
    const snapshot = this.snapshotEngine.snapshots.find(s => s.id === id);
    if (!snapshot) return;

    const newName = prompt('请输入新的快照名称:', snapshot.name);
    if (newName !== null && newName.trim()) {
      this.snapshotEngine.renameSnapshot(id, newName.trim());
      this.renderSnapshotList();
      this.updateCompareSelectors();
    }
  }

  renderSnapshotList() {
    const list = document.getElementById('snapshotList');

    if (this.snapshotEngine.snapshots.length === 0) {
      list.innerHTML = '<div class="snapshot-empty">暂无快照</div>';
      return;
    }

    list.innerHTML = '';
    this.snapshotEngine.snapshots.forEach(snapshot => {
      const item = document.createElement('div');
      item.className = 'snapshot-item';
      item.dataset.id = snapshot.id;

      const timeStr = snapshot.createdAt.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      item.innerHTML = `
        <div class="snapshot-info">
          <span class="snapshot-name">${snapshot.name}</span>
          <span class="snapshot-time">${timeStr}</span>
        </div>
        <div class="snapshot-actions">
          <button class="snapshot-action-btn rename-btn" title="重命名">✏️</button>
          <button class="snapshot-action-btn delete-btn" title="删除">🗑️</button>
        </div>
      `;

      item.querySelector('.rename-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameSnapshot(snapshot.id);
      });

      item.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSnapshot(snapshot.id);
      });

      list.appendChild(item);
    });
  }

  updateCompareSelectors() {
    const leftSel = document.getElementById('compareLeft');
    const rightSel = document.getElementById('compareRight');
    const snapshots = this.snapshotEngine.snapshots;

    const leftVal = leftSel.value;
    const rightVal = rightSel.value;

    leftSel.innerHTML = '<option value="">选择快照A</option>';
    rightSel.innerHTML = '<option value="">选择快照B</option>';

    snapshots.forEach(snapshot => {
      const opt1 = new Option(snapshot.name, snapshot.id);
      const opt2 = new Option(snapshot.name, snapshot.id);
      leftSel.appendChild(opt1);
      rightSel.appendChild(opt2);
    });

    if (snapshots.find(s => s.id == leftVal)) leftSel.value = leftVal;
    if (snapshots.find(s => s.id == rightVal)) rightSel.value = rightVal;

    const left = leftSel.value;
    const right = rightSel.value;
    document.getElementById('startCompareBtn').disabled = !left || !right || left === right;
  }

  startComparison() {
    const leftId = parseInt(document.getElementById('compareLeft').value);
    const rightId = parseInt(document.getElementById('compareRight').value);

    if (!leftId || !rightId || leftId === rightId) {
      alert('请选择两个不同的快照进行对比');
      return;
    }

    const success = this.snapshotEngine.enterComparison(leftId, rightId);
    if (!success) {
      alert('无法进入对比模式');
      return;
    }

    this.savedFilters = JSON.parse(JSON.stringify(this.config.filters));
    this.config.filters = [];

    this.configLocked = true;
    document.querySelector('.main-container').classList.add('config-locked');
    document.getElementById('compareBanner').style.display = 'flex';
    document.getElementById('startCompareBtn').style.display = 'none';
    document.getElementById('exitCompareBtn').style.display = '';
    document.getElementById('saveSnapshotBtn').disabled = true;

    const labels = this.snapshotEngine.getComparisonLabels();
    document.querySelector('.compare-banner-text').textContent =
      `📊 对比模式: ${labels.left} vs ${labels.right} — 维度配置已锁定`;

    this.renderZones();
    this.renderPivot();

    document.querySelectorAll('.zone-field').forEach(el => { el.draggable = false; });
    document.querySelectorAll('.field-item').forEach(el => { el.draggable = false; });
  }

  exitComparison() {
    this.snapshotEngine.exitComparison();
    this.configLocked = false;

    if (this.savedFilters) {
      this.config.filters = this.savedFilters;
      this.savedFilters = null;
    }

    document.querySelector('.main-container').classList.remove('config-locked');
    document.getElementById('compareBanner').style.display = 'none';
    document.getElementById('startCompareBtn').style.display = '';
    document.getElementById('exitCompareBtn').style.display = 'none';
    document.getElementById('saveSnapshotBtn').disabled = false;

    this.renderZones();
    this.renderPivot();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.pivotApp = new PivotApp();
});
