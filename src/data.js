const regions = ['华东', '华北', '华南', '华中', '西南', '西北', '东北'];
const categories = ['电子产品', '服装鞋帽', '食品饮料', '家居用品', '办公用品', '体育用品'];

const products = {
  '电子产品': ['智能手机', '笔记本电脑', '平板电脑', '智能手表', '无线耳机', '蓝牙音箱', '充电宝', '数据线'],
  '服装鞋帽': ['男士T恤', '女士连衣裙', '牛仔裤', '运动鞋', '休闲外套', '羽绒服', '衬衫', '围巾'],
  '食品饮料': ['牛奶', '面包', '矿泉水', '咖啡', '饼干', '巧克力', '果汁', '坚果礼盒'],
  '家居用品': ['洗衣液', '纸巾', '洗洁精', '保温杯', '收纳盒', '枕头', '被子', '毛巾'],
  '办公用品': ['签字笔', '笔记本', '文件夹', '订书机', '计算器', '打印纸', '便利贴', '剪刀'],
  '体育用品': ['篮球', '足球', '羽毛球拍', '瑜伽垫', '哑铃', '跳绳', '护腕', '运动水壶']
};

const customerLevels = ['普通客户', '银卡客户', '金卡客户', '钻石客户'];

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSalesData(count = 6000) {
  const data = [];
  const startDate = new Date('2023-01-01');
  const endDate = new Date('2024-12-31');

  for (let i = 0; i < count; i++) {
    const category = randomChoice(categories);
    const productName = randomChoice(products[category]);
    const quantity = Math.floor(Math.random() * 50) + 1;
    const unitPrice = Math.floor(Math.random() * 2000) + 50;
    const salesAmount = quantity * unitPrice;
    const profitRate = (Math.random() * 0.4 + 0.05).toFixed(4);

    data.push({
      id: i + 1,
      日期: formatDate(randomDate(startDate, endDate)),
      地区: randomChoice(regions),
      产品类别: category,
      产品名称: productName,
      客户等级: randomChoice(customerLevels),
      销售额: salesAmount,
      数量: quantity,
      利润率: parseFloat(profitRate)
    });
  }

  return data;
}

export const fields = [
  { key: '日期', label: '日期', type: 'dimension' },
  { key: '地区', label: '地区', type: 'dimension' },
  { key: '产品类别', label: '产品类别', type: 'dimension' },
  { key: '产品名称', label: '产品名称', type: 'dimension' },
  { key: '客户等级', label: '客户等级', type: 'dimension' },
  { key: '销售额', label: '销售额', type: 'measure' },
  { key: '数量', label: '数量', type: 'measure' },
  { key: '利润率', label: '利润率', type: 'measure' }
];

export const salesData = generateSalesData();
