import type { TopicOverview } from './dataset-overview-analysis.js';
import { overviewCsv } from './dataset-overview-io.js';

function escape(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/\|/gu, '&#124;')
    .replace(/`/gu, '&#96;')
    .replace(/[\r\n]/gu, ' ');
}

const DIMENSIONS = [
  'classification',
  'location',
  'reference_year',
  'dataset_type',
  'treatment_label',
] as const;
const LABELS = {
  classification: '分类路径',
  location: '地区',
  reference_year: '参考年份',
  dataset_type: '数据集类型',
  treatment_label: '处理/技术名称字段',
};

export function renderOverviewArtifacts(report: TopicOverview): Record<string, string> {
  const roleByKey = new Map(report.records.map((record) => [record.key, record.role]));
  const json = JSON.stringify(report, null, 2) + '\n';
  const summary = report.core_counts
    .map((count) => `| ${count.table} | ${count.objects} | ${count.public_revisions} |`)
    .join('\n');
  const distributions = report.statistics
    .filter((group) => group.denominator)
    .map((group) => {
      const charts = DIMENSIONS.map((dimension) => {
        const rows = group[dimension];
        return `### ${LABELS[dimension]}\n\n| 记录值 | 对象数 |\n| --- | ---: |\n${rows
          .slice(0, 10)
          .map((row) => `| ${escape(row.label)} | ${row.count} |`)
          .join(
            '\n',
          )}\n\n显示 ${Math.min(rows.length, 10)} / ${rows.length} 组；完整分组与成员见 statistics.csv。`;
      });
      return `## ${group.table} 的现状分布\n\n分母：${group.denominator} 个主题内对象。\n\n${charts.join('\n\n')}`;
    })
    .join('\n\n');
  const markdown = `# ${escape(report.scope.topic)}：公开数据现状\n\n${escape(report.scope.boundary)}\n\n范围为所有归属者的公开 state_code=100 数据。主题成员逐项记录在 scope.json；统计采用每个 UUID 最新公开版本，公开修订数另列。\n\n| 主题内数据 | 对象数 | 公开修订数 |\n| --- | ---: | ---: |\n${summary}\n\n已解析的参考产品 Flow UUID：${report.products.confirmed_flow_ids.length} 个。未找到参考交换的主题 Process：${report.products.processes_without_reference_exchange.length} 个；存在未解析产品引用的 Process：${report.products.processes_with_unresolved_reference.length} 个，其中 ${report.products.processes_with_ambiguous_reference.length} 个存在参考交换标识歧义。\n\n${distributions}\n\n## 上下游关联\n\n涉及 ${report.flow_usage.length} 组 Flow 引用；相关的最新公开 Process 数为 ${report.related_counts[0]!.objects}。每组分别记录输入/输出角色、不同 Process 数及 exchange 出现次数。未解析的 Flow 使用观察为 ${report.unresolved_flow_usages.length} 条。共用 Flow 仅表示可能的供需关联，不代表已选供应商、分配比例、数量或市场份额。\n\n公开 Model 中记录了 ${report.model_instances.length} 个过程实例、${report.model_connections.length} 条显式连接；其中 ${report.model_connections.filter((edge) => edge.status === 'exact_public_references').length} 条可同时对应公开的精确过程和 Flow 版本。实例包含关系与显式连接分开列示，完整连接见 model-connections.csv。\n\n## 统计口径与观察范围\n\n- 核心集合、关联集合和精确引用上下文分列；上下文不会增加核心对象数。\n- 每个分类组按对象去重；多分类可重叠。地区、年份和处理名称均为数据库记录值，缺失值单列。\n- 参考年份描述数据集，不是行业产量的时间序列；处理名称文本数量不是技术种类数。\n- 主题 Process 有 ${report.core_unresolved_exchanges.length} 条交换未能在公开清单中解析精确 Flow 引用，${report.core_unknown_direction_exchanges.length} 条交换未记录可识别的输入/输出方向。未解析不等于数据库对象不存在，也可能未公开或缺少版本。\n- 清单通过精确计数分页读取，多个请求不构成事务快照。公开清单本身不能证明行业总体覆盖率。\n- 关系读取为一跳共用 Flow 关联及已记录的 Model 结构；HTML 对大图和长表注明显示数量，JSON/CSV 保留完整分析结果。\n\n交互展示：overview.html。完整结果与来源清单摘要：overview.json。\n`;
  const statisticsRows = report.statistics.flatMap((group) =>
    DIMENSIONS.flatMap((dimension) =>
      group[dimension].map((row) => [
        group.table,
        dimension,
        row.label,
        group.denominator,
        row.count,
        row.record_keys.join('|'),
      ]),
    ),
  );
  const embedded = json
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
  return {
    'scope.json': JSON.stringify(report.scope, null, 2) + '\n',
    'records.csv': overviewCsv([
      [
        'key',
        'role',
        'table',
        'id',
        'version',
        'baseName',
        'treatmentStandardsRoutes',
        'mixAndLocationTypes',
        'flowProperties_or_functionalUnitFlowProperties',
        'classification',
        'location',
        'reference_year',
        'valid_until',
        'dataset_type',
      ],
      ...report.records.map((record) => [
        record.key,
        record.role,
        record.table,
        record.id,
        record.version,
        ...record.name_parts,
        record.classifications.join(' | '),
        record.location,
        record.reference_year,
        record.valid_until,
        record.dataset_type,
      ]),
    ]),
    'statistics.csv': overviewCsv([
      ['table', 'dimension', 'label', 'denominator', 'count', 'record_keys'],
      ...statisticsRows,
    ]),
    'flow-usage.csv': overviewCsv([
      [
        'flow_key',
        'flow_reference_resolved',
        'process_key',
        'process_role',
        'direction',
        'exchange_internal_id',
        'declared_reference_exchange',
        'reference_exchange_ambiguous',
        'confirmed_core_reference_product',
        'evidence',
      ],
      ...report.flow_usage.flatMap((flow) =>
        flow.exchanges.map((exchange) => [
          flow.flow_key,
          flow.resolved,
          exchange.process_key,
          roleByKey.get(exchange.process_key),
          exchange.direction,
          exchange.internal_id,
          exchange.reference,
          exchange.reference_ambiguous,
          roleByKey.get(exchange.process_key) === 'core' &&
            exchange.reference &&
            !exchange.reference_ambiguous &&
            flow.resolved,
          exchange.evidence,
        ]),
      ),
    ]),
    'model-connections.csv': overviewCsv([
      [
        'model_key',
        'source_instance',
        'target_instance',
        'source_process_key',
        'target_process_key',
        'flow_id',
        'flow_version',
        'target_flow_id',
        'target_flow_version',
        'status',
        'evidence',
      ],
      ...report.model_connections.map((edge) => [
        edge.model_key,
        edge.source_instance,
        edge.target_instance,
        edge.source_process_key,
        edge.target_process_key,
        edge.flow_id,
        edge.flow_version,
        edge.target_flow_id,
        edge.target_flow_version,
        edge.status,
        edge.evidence,
      ]),
    ]),
    'overview.md': markdown,
    'overview.html': `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(report.scope.topic)} · 公开数据现状</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#18313f;background:#f2f5f5}*{box-sizing:border-box}body{margin:0}main{max-width:1240px;margin:auto;padding:40px 24px}h1{font-size:36px;margin:12px 0}h2{margin:0 0 18px}h3{font-size:15px}p{line-height:1.8}.eyebrow{letter-spacing:.15em;color:#33776c;font-size:13px}section{background:white;border:1px solid #dde6e4;border-radius:16px;padding:24px;margin-top:24px}.muted{color:#536c76;font-size:13px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#e5f1ed;border-radius:12px;padding:18px}.card b{display:block;font-size:32px;margin:8px 0}.toolbar label{min-width:0;max-width:100%}select{max-width:100%}.toolbar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;align-items:center}select,input,button{font:inherit;border:1px solid #becfce;border-radius:8px;padding:9px;background:white;color:inherit}button{cursor:pointer}.bar{display:flex;width:100%;gap:12px;align-items:center;border:0;padding:8px}.bar span:first-child{width:35%;text-align:left;overflow-wrap:anywhere}.track{flex:1;background:#edf3f1;height:22px;border-radius:4px;overflow:hidden}.fill{height:100%;background:#4d9b86}.bar strong{width:45px;text-align:right}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:12px 8px;text-align:left;border-bottom:1px solid #e5eceb;vertical-align:top;overflow-wrap:anywhere}td:first-child{min-width:230px}code{font-size:11px;overflow-wrap:anywhere}summary{cursor:pointer}svg{width:100%;min-height:300px;background:#f8faf9;border-radius:10px}svg text{font-size:12px;fill:#193843}svg line{stroke:#8ba69e;stroke-width:1.4}svg rect{stroke:#8db6a8;fill:#e1f0e9}svg .center{fill:#c9e2ec;stroke:#85afbf}.table-wrap{overflow:auto}a{color:#226e60}.downloads{display:flex;gap:18px;flex-wrap:wrap}@media(max-width:650px){main{padding:24px 12px}h1{font-size:28px}.cards{grid-template-columns:repeat(2,1fr)}section{padding:16px}.bar span:first-child{width:48%}}
table{min-width:800px}.graph-wrap{overflow:auto}#graph{min-width:1100px}.pan-note{display:none}@media(max-width:650px){.pan-note{display:block}}
</style></head><body><main>
<header><div class="eyebrow">天工数据库 / 公开数据现状</div><h1>${escape(report.scope.topic)}</h1><p>${escape(report.scope.boundary)}</p><p class="muted">所有归属者的公开数据 · UUID 最新公开版本计数 · 统计与明细相互对应</p></header>
<div id="cards" class="cards"></div>
<section><h2>主题内数据分布</h2><div class="toolbar"><label>对象 <select id="stat-table" aria-label="统计对象"></select></label><label>维度 <select id="dimension" aria-label="统计维度"></select></label></div><div id="bars"></div><p id="chart-note" class="muted"></p></section>
<section><h2>上下游与模型连接</h2><div class="toolbar"><label>关系 <select id="relation-kind" aria-label="关系"><option value="flow">共用 Flow 的供需关联</option><option value="model">Model 显式连接</option></select></label><label>对象 <select id="relation-item" aria-label="关系对象"></select></label></div><p class="muted pan-note">横向滚动查看完整关系图。</p><div class="graph-wrap" tabindex="0" aria-label="可横向滚动的数据关联图"><svg id="graph" role="img" aria-label="数据关联图"></svg></div><p id="graph-note" class="muted"></p><p class="muted">共用 Flow 表示可能的供需关联。连线不表示已选供应商、分配比例、数量或市场份额。Model 的结构包含与显式连接分别记录，精确引用不能解析的连接保留其观察状态。</p></section>
<section id="records-section"><h2>数据明细</h2><div class="toolbar"><label>检索 <input aria-label="检索" id="search" type="search" placeholder="名称、UUID、地区"></label><label>集合 <select id="role" aria-label="集合"><option value="">全部</option><option value="core">主题内</option><option value="related">关联数据</option><option value="reference_context">精确引用上下文</option></select></label><button id="clear" type="button">清除分组筛选</button></div><p id="records-note" class="muted"></p><p class="muted pan-note">横向滚动查看完整数据列。</p><div class="table-wrap" tabindex="0" aria-label="可横向滚动的数据明细"><table><thead><tr><th>完整名称 / 标识</th><th>集合</th><th>类型</th><th>地区 / 参考年份</th></tr></thead><tbody id="rows"></tbody></table></div></section>
<section><h2>口径与数据文件</h2><p>核心成员由 scope.json 明确列出；引用按数据库记录的精确版本解析，较旧引用仅作上下文。缺失值单列，多分类可以重叠。参考年份是数据集信息，技术名称字段仅作文本分布。</p><p>清单经过精确计数分页校验，多次读取并非事务快照。未解析引用可能是版本缺失、对象未公开或本次清单未找到；公开数据清单不提供行业总体覆盖率的分母。</p><p id="observations" class="muted"></p><div class="downloads"><a href="overview.md">文字分析</a><a href="overview.json">完整 JSON</a><a href="records.csv">数据清单 CSV</a><a href="statistics.csv">统计与成员 CSV</a><a href="flow-usage.csv">Flow 使用 CSV</a><a href="model-connections.csv">模型连接 CSV</a></div></section>
</main><script id="overview-data" type="application/json">${embedded}</script><script>
const data=JSON.parse(document.getElementById('overview-data').textContent);
const el=id=>document.getElementById(id), titles={processes:'Process',flows:'Flow',lifecyclemodels:'Model'}, roles={core:'主题内',related:'关联数据',reference_context:'精确引用上下文'}, dimensions=${JSON.stringify(LABELS)};
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
const metadata=new Map(data.records.map(record=>[record.key,record]));let memberFilter=null;
function options(select,entries){select.replaceChildren(...entries.map(([value,label])=>{const option=make('option',label);option.value=value;return option}));}
data.core_counts.forEach(count=>{const card=make('div');card.className='card';card.append(make('span',titles[count.table]),make('b',String(count.objects)),make('small',count.public_revisions+' 个公开修订'));el('cards').append(card)});
const product=make('div');product.className='card';product.append(make('span','参考产品 Flow'),make('b',String(data.products.confirmed_flow_ids.length)),make('small','按已解析的 UUID 去重；'+data.products.processes_with_unresolved_reference.length+' 个 Process 的产品引用未解析，其中 '+data.products.processes_with_ambiguous_reference.length+' 个参考交换有歧义'));el('cards').append(product);
options(el('stat-table'),data.statistics.map(group=>[group.table,titles[group.table]]));options(el('dimension'),Object.entries(dimensions));
function chart(){const group=data.statistics.find(item=>item.table===el('stat-table').value),rows=group[el('dimension').value],max=rows.reduce((maximum,row)=>Math.max(maximum,row.count),1);el('bars').replaceChildren();rows.slice(0,15).forEach(row=>{const button=make('button');button.type='button';button.className='bar';const track=make('span');track.className='track';const fill=make('div');fill.className='fill';fill.style.width=(100*row.count/max)+'%';track.append(fill);button.append(make('span',row.label),track,make('strong',String(row.count)));button.onclick=()=>{memberFilter=new Set(row.record_keys);el('search').value='';el('role').value='';records();el('records-section').scrollIntoView({behavior:'smooth'})};el('bars').append(button)});el('chart-note').textContent='分母 '+group.denominator+' 个主题内对象；显示 '+Math.min(15,rows.length)+' / '+rows.length+' 组。点击条目查看成员。多分类组可重叠。'}
function records(){const query=el('search').value.toLocaleLowerCase(),role=el('role').value,rows=data.records.filter(record=>(!memberFilter||memberFilter.has(record.key))&&(!role||role===record.role)&&JSON.stringify(record).toLocaleLowerCase().includes(query));el('rows').replaceChildren();rows.slice(0,250).forEach(record=>{const row=make('tr'),name=make('td'),details=make('details');details.append(make('summary',record.name||'(名称未填写)'));record.name_parts.forEach((part,index)=>details.append(make('p',(index+1)+'. '+(part||'（空）'))));name.append(details,make('code',record.key));row.append(name,make('td',roles[record.role]),make('td',titles[record.table]+' · '+record.dataset_type),make('td',(record.location||'（未填写）')+' / '+(record.reference_year||'（未填写）')));el('rows').append(row)});el('records-note').textContent='显示 '+Math.min(250,rows.length)+' / '+rows.length+' 条匹配记录；导出文件保留全部 '+data.records.length+' 条记录。';}
const svgNode=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,String(value)));return node};
function draw(nodes,edges){const svg=el('graph');svg.replaceChildren();const defs=svgNode('defs',{}),marker=svgNode('marker',{id:'arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});marker.append(svgNode('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#658c80'}));defs.append(marker);svg.append(defs);const height=Math.max(360,...nodes.map(node=>node.y+60));svg.setAttribute('viewBox','0 0 1100 '+height);const positions=new Map(nodes.map(node=>[node.id,node]));edges.forEach(edge=>{const source=positions.get(edge.from),target=positions.get(edge.to);if(source&&target){const line=source.id===target.id?svgNode('path',{d:'M '+(source.x+280)+' '+(source.y+8)+' C '+(source.x+335)+' '+(source.y-24)+' '+(source.x+335)+' '+(source.y+64)+' '+(source.x+280)+' '+(source.y+32),'data-self-loop':'true',fill:'none',stroke:'#8ba69e','stroke-width':1.4,'marker-end':'url(#arrow)'}):svgNode('line',{x1:source.x+140,y1:source.y+40,x2:target.x+140,y2:target.y,'marker-end':'url(#arrow)'});const title=svgNode('title',{});title.textContent=edge.label;line.append(title);svg.append(line)}});nodes.forEach(node=>{const group=svgNode('g',{}),rect=svgNode('rect',{x:node.x,y:node.y,width:280,height:40,rx:7,class:node.center?'center':''}),label=svgNode('text',{x:node.x+10,y:node.y+25}),title=svgNode('title',{});label.textContent=node.label.slice(0,25);title.textContent=node.label+' · '+node.key;group.append(rect,label,title);group.addEventListener('click',()=>{memberFilter=null;el('search').value=node.key;el('role').value='';records()});svg.append(group)});}
function relationOptions(){const entries=el('relation-kind').value==='flow'?data.flow_usage.map(flow=>[flow.flow_key,(flow.name||flow.flow_id)+' @'+flow.flow_version]):[...new Set(data.model_instances.map(instance=>instance.model_key))].map(key=>[key,metadata.get(key)?.name||key]);options(el('relation-item'),entries);graph();}
function graph(){const key=el('relation-item').value,nodes=[],edges=[];if(el('relation-kind').value==='flow'){const flow=data.flow_usage.find(item=>item.flow_key===key);if(!flow){draw([],[]);el('graph-note').textContent='当前范围没有可展示的 Flow 使用记录。';return}nodes.push({id:'flow',key:flow.flow_key,label:flow.name||flow.flow_key,x:410,y:120,center:true});let shown=0;['output','input'].forEach((direction,column)=>{const keys=[...new Set(flow.exchanges.filter(exchange=>exchange.direction===direction).map(exchange=>exchange.process_key))];keys.slice(0,20).forEach((process,index)=>{const id=direction+process;nodes.push({id,key:process,label:metadata.get(process)?.name||process,x:column*800+10,y:index*56+10});if(flow.resolved)edges.push({from:column?'flow':id,to:column?id:'flow',label:direction+' · '+flow.flow_key});shown++})});draw(nodes,edges);el('graph-note').textContent='左：提供该 Flow 的过程；右：使用该 Flow 的过程。显示 '+shown+' / '+(flow.input_process_count+flow.output_process_count)+' 个输入/输出角色节点；共 '+flow.process_count+' 个不同 Process，'+flow.exchange_occurrences+' 条 exchange。精确 Flow 引用'+(flow.resolved?'已解析':'未解析')+'；方向未知或精确 Flow 引用未解析时，不绘制供需连线。'}else{const instances=data.model_instances.filter(instance=>instance.model_key===key),links=data.model_connections.filter(edge=>edge.model_key===key);instances.slice(0,60).forEach((instance,index)=>nodes.push({id:instance.evidence,key:instance.process_key,label:instance.internal_id+' · '+(metadata.get(instance.process_key)?.name||instance.process_key),x:(index%3)*360+10,y:Math.floor(index/3)*85+15}));const ids=new Set(nodes.map(node=>node.id)),visible=links.filter(edge=>ids.has(edge.source_instance)&&ids.has(edge.target_instance)).slice(0,120);visible.forEach(edge=>edges.push({from:edge.source_instance,to:edge.target_instance,label:edge.flow_id+' @'+edge.flow_version+' → '+edge.target_flow_id+' @'+edge.target_flow_version+' · '+edge.status}));draw(nodes,edges);el('graph-note').textContent='显示 '+nodes.length+' / '+instances.length+' 个实例、'+visible.length+' / '+links.length+' 条已声明连接。目标实例缺失/歧义及显示限制下的连接保留在完整数据文件中；悬停连线查看引用观察状态。'}}
el('stat-table').onchange=chart;el('dimension').onchange=chart;el('search').oninput=records;el('role').onchange=records;el('clear').onclick=()=>{memberFilter=null;el('search').value='';el('role').value='';records()};el('relation-kind').onchange=relationOptions;el('relation-item').onchange=graph;
el('observations').textContent='当前范围未解析 Flow 使用：'+data.unresolved_flow_usages.length+'；主题内未解析 Flow 交换：'+data.core_unresolved_exchanges.length+'；未观察到参考交换的 Process：'+data.products.processes_without_reference_exchange.length+'。'+(data.capture?'采集区间：'+data.capture.started_at_utc+' 至 '+data.capture.finished_at_utc+'。':'');chart();records();relationOptions();
</script></body></html>`,
    'overview.json': json,
  };
}
