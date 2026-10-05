/* ============================================================
 * IPTV 节目单管理客户端  (pure front-end, no backend)
 * 支持两种格式:
 *   1) 中文 IPTV 源 (taksssss 风格):  分组行 "组名,#genre#..."   频道行 "名称,url1#url2#url3"
 *   2) 标准 M3U:  #EXTM3U / #EXTINF:-1 ... ,名称  + 下一行 URL
 * ========================================================== */
'use strict';

/* ---------- 状态 ---------- */
const LS_KEY = 'tvlist_channels_v1';
const LS_EPG = 'tvlist_epg_url_v1';
let _id = 0;
const state = {
  channels: [],          // {id,name,group,logo,tvgId,urls:[]}
  filterGroup: '__all__',
  search: '',
  sort: 'order',
  selected: new Set(),
  epg: { byId:{}, byName:{}, programmes:{} },
  epgUrl: localStorage.getItem(LS_EPG) || 'epg.xml',
  activeId: null,
};

/* ---------- 工具 ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg, ms=2200){
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.hidden=true, ms);
}
function mkChannel(o){
  return {
    id: ++_id,
    name: (o.name||'未命名').trim(),
    group: (o.group||'未分组').trim(),
    logo: (o.logo||'').trim(),
    tvgId: (o.tvgId||'').trim(),
    urls: (o.urls && o.urls.length) ? o.urls.map(u=>u.trim()).filter(Boolean)
         : (o.url ? [o.url.trim()].filter(Boolean) : []),
  };
}

/* ---------- 解析 ---------- */
function parsePlaylist(text){
  text = text.replace(/^﻿/, '');
  if (/#EXTM3U/i.test(text.slice(0, 200))) return parseM3U(text);
  if (/#genre#/.test(text)) return parseGenre(text);
  // 兜底：当作 genre 解析
  return parseGenre(text);
}

function parseGenre(text){
  const lines = text.split(/\r?\n/);
  const out = []; let g = '未分组';
  for (let raw of lines){
    const line = raw.trim();
    if (!line) continue;
    if (line.includes('#genre#')){
      const name = line.split(',')[0].trim();
      if (name) g = name;
      continue;
    }
    const idx = line.indexOf(',');
    if (idx < 0) continue;                 // 跳过无法识别的行
    const name = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (!name) continue;
    const urls = rest.split('#').map(u=>u.trim()).filter(Boolean);
    if (!urls.length) continue;
    out.push(mkChannel({ name, group: g, urls }));
  }
  return out;
}

function parseM3U(text){
  const lines = text.split(/\r?\n/);
  const out = []; let pending = null;
  const reAttr = /([a-zA-Z][\w-]*)="([^"]*)"/g;
  for (let line of lines){
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF')){
      const attrs = {}; let m; reAttr.lastIndex = 0;
      while ((m = reAttr.exec(line))) attrs[m[1].toLowerCase()] = m[2];
      const ci = line.indexOf(',');
      const name = (ci >= 0 ? line.slice(ci + 1) : '').trim() || attrs['tvg-name'] || '未命名';
      pending = mkChannel({ name, group: attrs['group-title'] || '未分组',
        logo: attrs['tvg-logo'] || '', tvgId: attrs['tvg-id'] || '', urls: [] });
      continue;
    }
    if (line.startsWith('#')) continue;       // 其它指令行忽略
    if (pending){
      pending.urls.push(line); out.push(pending); pending = null;
    } else {
      out.push(mkChannel({ name: line.slice(0, 48), group: '未分组', url: line }));
    }
  }
  return out;
}

/* ---------- 渲染 ---------- */
function groupsOf(chs){
  const map = new Map();
  for (const c of chs){ map.set(c.group, (map.get(c.group)||0) + 1); }
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0],'zh'));
}
function visibleChannels(){
  let list = state.channels;
  if (state.filterGroup !== '__all__') list = list.filter(c => c.group === state.filterGroup);
  if (state.search){
    const q = state.search.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q) || (c.group||'').toLowerCase().includes(q));
  }
  if (state.sort === 'name') list = [...list].sort((a,b)=>a.name.localeCompare(b.name,'zh'));
  else if (state.sort === 'group') list = [...list].sort((a,b)=>a.group.localeCompare(b.group,'zh') || a.name.localeCompare(b.name,'zh'));
  else if (state.sort === 'src') list = [...list].sort((a,b)=>b.urls.length - a.urls.length);
  return list;
}

function renderStats(){
  const total = state.channels.length;
  const g = groupsOf(state.channels).length;
  const epgCh = Object.keys(state.epg.programmes).length;
  $('#stats').textContent = `共 ${total} 个频道 · ${g} 个分组 · EPG 已匹配 ${epgCh} 个频道`;
}

function renderGroups(){
  const box = $('#groups'); const all = state.channels.length;
  let html = `<div class="group-item ${state.filterGroup==='__all__'?'active':''}" data-g="__all__">
      <span>📋 全部</span><span class="cnt">${all}</span></div>`;
  for (const [name, cnt] of groupsOf(state.channels)){
    html += `<div class="group-item ${state.filterGroup===name?'active':''}" data-g="${escapeHtml(name)}">
      <span>${escapeHtml(name)}</span><span class="cnt">${cnt}</span></div>`;
  }
  box.innerHTML = html;
  $$('.group-item', box).forEach(el => el.onclick = () => {
    state.filterGroup = el.dataset.g; renderGroups(); renderChannels();
  });
}

function renderChannels(){
  const box = $('#channels'); const list = visibleChannels();
  if (!list.length){ box.innerHTML = `<div class="empty">没有匹配的频道</div>`; updateSelCount(); return; }
  box.innerHTML = list.map(c => {
    const hasEpg = epgFor(c).length > 0;
    const logo = c.logo
      ? `<img class="logo" src="${escapeHtml(c.logo)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'logo ph',textContent:'📺'}))">`
      : `<div class="logo ph">📺</div>`;
    return `<div class="card ${state.selected.has(c.id)?'sel':''}" data-id="${c.id}">
      ${logo}
      <div class="info">
        <div class="name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
        <div class="meta">
          <span class="chip">${escapeHtml(c.group)}</span>
          <span class="chip">${c.urls.length} 源</span>
          ${hasEpg?'<span class="chip epg-ok">EPG</span>':''}
        </div>
      </div>
      <div class="ops">
        <button data-act="play" title="预览">▶</button>
        <button data-act="edit" title="编辑">✎</button>
        <button data-act="dup" title="复制">⧉</button>
        <button data-act="del" title="删除">🗑</button>
      </div>
      <input class="chk" type="checkbox" data-chk="${c.id}" ${state.selected.has(c.id)?'checked':''}>
    </div>`;
  }).join('');

  $$('.card', box).forEach(card => {
    const id = +card.dataset.id;
    const ch = state.channels.find(c=>c.id===id);
    card.querySelector('.info').onclick = (e)=>{ if(e.target.classList.contains('chk'))return; openDetail(ch); };
    card.querySelector('.logo').onclick = ()=>openDetail(ch);
    card.querySelector('.chk').onchange = (e)=>{
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
      card.classList.toggle('sel', e.target.checked); updateSelCount();
    };
    card.querySelectorAll('.ops button').forEach(b => b.onclick = (e)=>{
      e.stopPropagation();
      const a = b.dataset.act;
      if (a==='play') openDetail(ch, true);
      else if (a==='edit') openEdit(ch);
      else if (a==='dup') duplicateChannel(ch);
      else if (a==='del') deleteChannels([ch.id]);
    });
  });
  updateSelCount();
}

function updateSelCount(){
  const n = state.selected.size;
  $('#sel-count').textContent = n ? `已选 ${n} 个` : '';
  const list = visibleChannels();
  $('#sel-all').checked = n>0 && n===list.length;
}

/* ---------- 详情 / EPG / 播放 ---------- */
function openDetail(ch, autoplay){
  state.activeId = ch.id;
  const m = matchEpg(ch);
  const hasEpg = m.progs.length > 0;
  const logo = ch.logo ? `<img src="${escapeHtml(ch.logo)}" onerror="this.style.display='none'">` : '📺';
  let html = `<div class="d-title">${logo}<span>${escapeHtml(ch.name)}</span></div>
    <div class="d-sub">分组：${escapeHtml(ch.group)}${ch.tvgId?` · tvg-id: ${escapeHtml(ch.tvgId)}`:''} · ${ch.urls.length} 个源</div>`;

  // 播放器
  html += `<div class="d-sec">▶ 预览播放</div><div id="player-slot"></div>`;

  // EPG
  html += `<div class="d-sec">📡 节目单 (EPG)${hasEpg?` <span class="epg-badge">已匹配 ${escapeHtml(m.name||m.id||'')} · ${escapeHtml(m.by||'')}</span>`:''}</div>`;
  if (hasEpg){
    const progs = m.progs;
    const now = Date.now();
    const cur = progs.find(p => p.start<=now && p.stop>now);
    const next = progs.find(p => p.start>now);
    if (cur) html += `<div class="epg-now"><div class="lab">正在播放</div><div class="t">${escapeHtml(cur.title)}</div>
      <div class="muted">${fmt(cur.start)} – ${fmt(cur.stop)}</div></div>`;
    if (next) html += `<div class="muted" style="margin:4px 0 8px">接下来：${escapeHtml(next.title)} · ${fmt(next.start)}</div>`;
    html += '<ul class="epg-list">' + progs.slice().sort((a,b)=>a.start-b.start).map(p=>{
      const cls = p.stop<=now?'past':(p.start<=now&&p.stop>now?'cur':'');
      return `<li class="${cls}"><span class="tm">${fmt(p.start)}</span><span>${escapeHtml(p.title)}</span></li>`;
    }).join('') + '</ul>';
  } else {
    html += `<div class="muted">该频道暂无 EPG。点击右上角 📡 加载 XMLTV 后自动匹配（按 tvg-id 或名称）。</div>`;
  }

  // 源列表
  html += `<div class="d-sec">🔗 播放地址</div><ul class="urls">` + ch.urls.map((u,i)=>
    `<li><code title="${escapeHtml(u)}">${i+1}. ${escapeHtml(u)}</code>
      <button data-copy="${escapeHtml(u)}">复制</button></li>`).join('') + `</ul>`;

  html += `<div style="margin-top:14px;display:flex;gap:8px">
      <button class="primary" id="d-edit">✎ 编辑</button>
      <button id="d-dup">⧉ 复制</button>
      <button class="danger" id="d-del">🗑 删除</button></div>`;

  const d = $('#detail'); d.innerHTML = html;
  $('#d-edit').onclick = ()=>openEdit(ch);
  $('#d-dup').onclick = ()=>duplicateChannel(ch);
  $('#d-del').onclick = ()=>deleteChannels([ch.id]);
  $$('[data-copy]', d).forEach(b => b.onclick = ()=>copyText(b.dataset.copy));
  mountPlayer(ch, $('#player-slot'), autoplay);
}

let _hls = null;
function mountPlayer(ch, slot, autoplay){
  if (_hls){ try{_hls.destroy();}catch(_){} _hls=null; }
  const url = pickPlayable(ch.urls);
  if (!url){ slot.innerHTML = `<div class="note">浏览器无法直接播放该协议（rtsp / udp / 组播等需外部播放器）。<br>可在上方地址列表中复制后，用 VLC / IPTV 播放器打开。</div>`; return; }
  if (/\.m3u8(\?|$)/i.test(url) && window.Hls && Hls.isSupported()){
    slot.innerHTML = `<div class="player"><video controls autoplay=${autoplay?'autoplay':''}></video></div>`;
    const v = $('video', slot); _hls = new Hls({lowLatencyMode:false});
    _hls.loadSource(url); _hls.attachMedia(v);
    _hls.on(Hls.Events.ERROR, (e,data)=>{ if(data.fatal){ slot.innerHTML = `<div class="note">HLS 加载失败：${escapeHtml(data.details||'')}。请检查地址可达性，或复制后用外部播放器。</div>`; } });
  } else if (url.startsWith('http') && /\.m3u8/i.test(url) && $('video') && document.createElement('video').canPlayType('application/vnd.apple.mpegurl')){
    slot.innerHTML = `<div class="player"><video controls ${autoplay?'autoplay':''} src="${escapeHtml(url)}"></video></div>`;
  } else {
    slot.innerHTML = `<div class="note">该地址类型（${escapeHtml(url.split(':')[0]||'http')}）浏览器支持有限，建议复制后用外部播放器打开。</div>`;
  }
}
function pickPlayable(urls){
  // 优先 http(s) 中可播放的；其它（rtsp/udp/igmp）留作复制
  return urls.find(u=>/^https?:/i.test(u)) || urls[0] || '';
}

/* ---------- EPG 解析 ---------- */
function parseEPGtime(s){
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const Y=+m[1], Mo=+m[2], D=+m[3], H=+m[4], Mi=+m[5], S=+m[6];
  const d = Date.UTC(Y, Mo-1, D, H, Mi, S);
  const tz = s.slice(15).trim();
  let off = 0;
  if (/^[+-]\d{4}$/.test(tz)){ const sign = tz[0]==='+'?1:-1; off = sign * ((+tz.slice(1,3))*60 + (+tz.slice(3,5))) * 60000; }
  return new Date(d - off);
}
function fmt(dt){ if(!dt||isNaN(dt)) return ''; try{ return new Date(dt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(_){ return ''; } }

async function gunzipText(buf){
  const ds = new DecompressionStream('gzip');
  const stream = new Response(buf).body.pipeThrough(ds);
  return await new Response(stream).text();
}
async function loadEpg(url){
  if (!url) return;
  toast('正在加载 EPG: ' + url);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let txt;
    if (/\.gz($|\?)/i.test(url)) {
      const buf = await r.arrayBuffer();
      txt = await gunzipText(buf);
    } else {
      txt = await r.text();
    }
    const doc = new DOMParser().parseFromString(txt, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML 解析失败');
    const epg = { byId:{}, byName:{}, normIndex:{}, coreIndex:{}, programmes:{} };
    for (const c of [...doc.getElementsByTagName('channel')]){
      const id = c.getAttribute('id'); if(!id) continue;
      const dns = [...c.getElementsByTagName('display-name')].map(x=>x.textContent.trim()).filter(Boolean);
      const name = dns[0] || id;
      epg.byId[id] = name; epg.byName[name.toLowerCase()] = id;
      // 归一化 / 核心标识索引，用于模糊匹配（CCTV1/CCTV-1/CCTV1综合、浙江卫视/浙江卫视4K 等）
      const aliases = [id, name, ...dns];
      for (const a of aliases){
        const na = normName(a);
        if (na) epg.normIndex[na] = id;
        const ck = coreKey(a);
        if (ck && !epg.coreIndex[ck]) epg.coreIndex[ck] = id;  // 首个核心命中优先（更接近原标识）
      }
    }
    for (const p of [...doc.getElementsByTagName('programme')]){
      const ch = p.getAttribute('channel'); if(!ch) continue;
      const title = p.getElementsByTagName('title')[0];
      const st = parseEPGtime(p.getAttribute('start'));
      const sp = parseEPGtime(p.getAttribute('stop'));
      if (!st) continue;
      (epg.programmes[ch] = epg.programmes[ch] || []).push({ start:st, stop:sp||st, title: title?title.textContent.trim():'' });
    }
    state.epg = epg; state.epgUrl = url; localStorage.setItem(LS_EPG, url);
    renderStats(); renderChannels();
    if (state.activeId){ const c = state.channels.find(x=>x.id===state.activeId); if(c) openDetail(c); }
    toast(`EPG 加载完成：频道 ${Object.keys(epg.byId).length} 个，含节目 ${Object.values(epg.programmes).reduce((a,b)=>a+b.length,0)} 条`);
  } catch(err){ toast('EPG 加载失败：' + err.message); }
}
/* ---------- EPG 名称归一化与模糊匹配 ---------- */
// 归一化：小写 + 去空白与常见分隔符，使 CCTV1 / CCTV-1 / CCTV1综合 等写法互通
function normName(s){
  return (s||'').toLowerCase().replace(/[\s\-_·./、()（）]/g,'');
}
// 核心标识：CCTV 系列取 cctv+数字+字母后缀（K/+/8K 等保留，使 CCTV4K 独立；CCTV1综合 的去中文后缀仍归 CCTV1）；
// 其余去掉末尾修饰词（综合/频道/高清/4K 等），如 浙江卫视4K -> 浙江卫视
const EPG_MOD_SUFFIX = /(综合|频道|高清|超清|标清|hd|4k|sd|plus|版|电视台)$/;
function coreKey(s){
  const n = normName(s);
  const m = n.match(/cctv(\d+)([a-z+]*)/);
  if (m) return 'cctv'+m[1]+m[2];
  let c = n, prev;
  do { prev = c; c = c.replace(EPG_MOD_SUFFIX, ''); } while (c !== prev && c.length > 0);
  return c;
}
// 多级匹配：tvg-id → 名称归一化精确 → 核心标识（宽松）
function matchEpg(ch){
  const epg = state.epg;
  if (!epg || !ch) return { id:null, name:null, by:null, progs:[] };
  // 1) tvg-id（原样或归一化）
  if (ch.tvgId){
    const tid = ch.tvgId.trim();
    if (epg.byId[tid] || epg.programmes[tid])
      return { id:tid, name:epg.byId[tid]||tid, by:'tvg-id', progs:epg.programmes[tid]||[] };
    const nid = normName(tid);
    if (epg.normIndex[nid]){ const id = epg.normIndex[nid]; return { id, name:epg.byId[id]||id, by:'tvg-id', progs:epg.programmes[id]||[] }; }
  }
  // 2) 名称归一化精确
  const nName = normName(ch.name);
  if (nName && epg.normIndex[nName]){
    const id = epg.normIndex[nName];
    return { id, name:epg.byId[id]||id, by:'名称精确', progs:epg.programmes[id]||[] };
  }
  // 3) 核心标识（宽松：CCTV1综合 <-> CCTV-1、浙江卫视4K <-> 浙江卫视）
  const ck = coreKey(ch.name);
  if (ck && epg.coreIndex[ck]){
    const id = epg.coreIndex[ck];
    return { id, name:epg.byId[id]||id, by:'核心匹配', progs:epg.programmes[id]||[] };
  }
  return { id:null, name:null, by:null, progs:[] };
}
function epgFor(ch){ return matchEpg(ch).progs; }

/* ---------- 编辑 / 新增 / 删除 ---------- */
function openEdit(ch){
  const isNew = !ch;
  $('#modal-title').textContent = isNew ? '新增频道' : '编辑频道';
  const c = ch || { name:'', group: state.filterGroup==='__all__'?'':state.filterGroup, logo:'', tvgId:'', urls:[''] };
  $('#modal-body').innerHTML = `
    <div class="row2">
      <div class="field"><label>频道名称</label><input id="f-name" value="${escapeHtml(c.name)}"></div>
      <div class="field"><label>分组 (group-title)</label><input id="f-group" value="${escapeHtml(c.group)}" list="grp-list"></div>
    </div>
    <datalist id="grp-list">${groupsOf(state.channels).map(([n])=>`<option value="${escapeHtml(n)}">`).join('')}</datalist>
    <div class="row2">
      <div class="field"><label>Logo 地址 (tvg-logo)</label><input id="f-logo" value="${escapeHtml(c.logo)}" placeholder="https://..."></div>
      <div class="field"><label>tvg-id (用于 EPG 匹配)</label><input id="f-tvg" value="${escapeHtml(c.tvgId)}"></div>
    </div>
    <div class="field"><label>播放地址（每行一个；genre 格式会以 # 连接多源）</label>
      <textarea id="f-urls">${escapeHtml((c.urls||[]).join('\n'))}</textarea></div>`;
  $('#modal-foot').innerHTML = `<button id="m-cancel">取消</button><button class="primary" id="m-save">保存</button>`;
  $('#modal-mask').hidden = false;
  $('#m-cancel').onclick = closeModal;
  $('#m-save').onclick = ()=>{
    const name = $('#f-name').value.trim();
    const urls = $('#f-urls').value.split('\n').map(s=>s.trim()).filter(Boolean);
    if (!name){ toast('请填写频道名称'); return; }
    if (!urls.length){ toast('请至少填写一个播放地址'); return; }
    if (isNew){
      const nc = mkChannel({ name, group:$('#f-group').value, logo:$('#f-logo').value, tvgId:$('#f-tvg').value, urls });
      state.channels.push(nc); toast('已新增：' + name);
    } else {
      ch.name = name; ch.group = $('#f-group').value.trim()||'未分组';
      ch.logo = $('#f-logo').value.trim(); ch.tvgId = $('#f-tvg').value.trim(); ch.urls = urls;
      toast('已保存：' + name);
    }
    persist(); renderAll();
    if (!isNew && state.activeId===ch.id) openDetail(ch);
    closeModal();
  };
  setTimeout(()=>$('#f-name').focus(), 30);
}
function duplicateChannel(ch){
  const nc = mkChannel({ name: ch.name + ' (副本)', group: ch.group, logo: ch.logo, tvgId: ch.tvgId, urls: [...ch.urls] });
  const i = state.channels.indexOf(ch);
  state.channels.splice(i+1, 0, nc);
  persist(); renderAll(); toast('已复制：' + ch.name);
}
function deleteChannels(ids){
  if (!ids.length) return;
  if (!confirm(`确认删除 ${ids.length} 个频道？`)) return;
  state.channels = state.channels.filter(c=>!ids.includes(c.id));
  ids.forEach(id=>state.selected.delete(id));
  if (state.activeId && ids.includes(state.activeId)){ state.activeId=null; $('#detail').innerHTML='<div class="placeholder">← 在中间选择一个频道，查看 EPG 节目单与预览播放</div>'; }
  persist(); renderAll(); toast('已删除 ' + ids.length + ' 个频道');
}

/* ---------- 导入 / 导出 ---------- */
function toM3U(chs){
  let s = '#EXTM3U\n';
  for (const c of chs){
    const a = [];
    if (c.tvgId) a.push(`tvg-id="${c.tvgId}"`);
    if (c.tvgId || c.name) a.push(`tvg-name="${c.name}"`);
    if (c.logo) a.push(`tvg-logo="${c.logo}"`);
    a.push(`group-title="${c.group}"`);
    s += `#EXTINF:-1 ${a.join(' ')},${c.name}\n`;
    s += `${c.urls[0]||''}\n`;
  }
  return s;
}
function toGenre(chs){
  const order = [], map = new Map();
  for (const c of chs){
    if (!map.has(c.group)){ map.set(c.group, []); order.push(c.group); }
    map.get(c.group).push(c);
  }
  let s = '';
  for (const g of order){ s += `${g},#genre#\n`; for (const c of map.get(g)) s += `${c.name},${c.urls.join('#')}\n`; }
  return s;
}
function download(filename, text, mime='text/plain'){
  const blob = new Blob([text], {type:mime+';charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function copyText(t){ navigator.clipboard?.writeText(t).then(()=>toast('已复制')).catch(()=>toast('复制失败')); }

function openExport(){
  $('#modal-title').textContent = '导出播放列表';
  $('#modal-body').innerHTML = `<div class="muted" style="margin-bottom:10px">导出当前（含筛选后的可见）频道。推荐用「中文源」格式以兼容 taksssss/IPTV 播放器。</div>`;
  $('#modal-foot').innerHTML = `
    <button id="ex-genre">⬇ 中文源 (.txt)</button>
    <button id="ex-m3u">⬇ 标准 M3U</button>
    <button id="ex-copy">📋 复制中文源</button>
    <button id="m-cancel">关闭</button>`;
  $('#modal-mask').hidden = false;
  const list = visibleChannels();
  $('#ex-genre').onclick = ()=>{ download('tvlist.txt', toGenre(list), 'text/plain'); toast('已导出 '+list.length+' 个频道 (中文源)'); };
  $('#ex-m3u').onclick = ()=>{ download('tvlist.m3u', toM3U(list), 'application/x-mpegurl'); toast('已导出 '+list.length+' 个频道 (M3U)'); };
  $('#ex-copy').onclick = ()=>copyText(toGenre(list));
  $('#m-cancel').onclick = closeModal;
}

/* ---------- 写回 GitHub 仓库 ---------- */
const LS_SET = 'tvlist_github_settings_v1';
function loadSettings(){ try{ return JSON.parse(localStorage.getItem(LS_SET)) || {}; }catch(_){ return {}; } }
function saveSettings(s){ try{ localStorage.setItem(LS_SET, JSON.stringify(s)); }catch(_){} }
function b64encode(str){
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function githubCommit(cfg, message, files){
  const { owner, repo, branch, token } = cfg;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { 'Authorization':`Bearer ${token}`, 'Accept':'application/vnd.github+json',
    'Content-Type':'application/json', 'X-GitHub-Api-Version':'2022-11-28' };
  const ref = await fetch(`${api}/git/refs/heads/${branch}`, {headers}).then(r=>{ if(!r.ok) throw new Error('读取分支失败 HTTP '+r.status); return r.json(); });
  const baseSha = ref.object.sha;
  const base = await fetch(`${api}/git/commits/${baseSha}`, {headers}).then(r=>r.json());
  const baseTree = base.tree.sha;
  const entries = [];
  for (const f of files){
    const blob = await fetch(`${api}/git/blobs`, {method:'POST', headers, body:JSON.stringify({content:b64encode(f.content), encoding:'base64'})})
      .then(r=>{ if(!r.ok) throw new Error('创建 blob 失败'); return r.json(); });
    entries.push({ path:f.path, mode:'100644', type:'blob', sha:blob.sha });
  }
  const tree = await fetch(`${api}/git/trees`, {method:'POST', headers, body:JSON.stringify({base_tree:baseTree, tree:entries})})
    .then(r=>{ if(!r.ok) throw new Error('创建 tree 失败'); return r.json(); });
  const commit = await fetch(`${api}/git/commits`, {method:'POST', headers, body:JSON.stringify({message, tree:tree.sha, parents:[baseSha]})})
    .then(r=>{ if(!r.ok) throw new Error('创建 commit 失败'); return r.json(); });
  await fetch(`${api}/git/refs/heads/${branch}`, {method:'PATCH', headers, body:JSON.stringify({sha:commit.sha})})
    .then(r=>{ if(!r.ok) throw new Error('更新引用失败'); return r.json(); });
  return { short: commit.sha.slice(0,7) };
}
function openCreds(then){
  const s = loadSettings();
  $('#modal-title').textContent = '保存到 GitHub 仓库';
  $('#modal-body').innerHTML = `
    <div class="muted" style="margin-bottom:10px">把当前频道列表以「中文源」格式写回仓库的 <code>index.m3u</code> 与 <code>yc.txt</code>（一次提交）。需要具有 repo 权限的 Personal Access Token。令牌仅保存在本浏览器，不会写入仓库或源码。</div>
    <div class="row2">
      <div class="field"><label>仓库 owner</label><input id="c-owner" value="${escapeHtml(s.owner||'kob')}"></div>
      <div class="field"><label>仓库名</label><input id="c-repo" value="${escapeHtml(s.repo||'tvlist')}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>分支</label><input id="c-branch" value="${escapeHtml(s.branch||'main')}"></div>
      <div class="field"><label>PAT 令牌</label><input id="c-token" type="password" value="${escapeHtml(s.token||'')}" placeholder="ghp_..."></div>
    </div>
    <label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="c-remember" ${s.token?'checked':''}> 记住令牌（仅本浏览器 localStorage，取消勾选并写回即可清除）</label>`;
  $('#modal-foot').innerHTML = `<button id="m-clear">清除已存令牌</button><button id="m-cancel">取消</button><button class="primary" id="m-ok">写回仓库</button>`;
  $('#modal-mask').hidden = false;
  $('#m-cancel').onclick = closeModal;
  $('#m-clear').onclick = ()=>{ saveSettings({owner:s.owner||'kob',repo:s.repo||'tvlist',branch:s.branch||'main'}); $('#c-token').value=''; $('#c-remember').checked=false; toast('已清除本浏览器保存的令牌'); };
  $('#m-ok').onclick = ()=>{
    const cfg = { owner:$('#c-owner').value.trim()||'kob', repo:$('#c-repo').value.trim()||'tvlist',
      branch:$('#c-branch').value.trim()||'main', token:$('#c-token').value.trim() };
    if (!cfg.token){ toast('请填写 PAT 令牌'); return; }
    if ($('#c-remember').checked) saveSettings(cfg); else saveSettings({owner:cfg.owner,repo:cfg.repo,branch:cfg.branch});
    closeModal(); then(cfg);
  };
}
function saveToRepo(){
  const content = toGenre(state.channels);   // 全部频道，中文源格式
  const doCommit = (cfg)=>{
    toast('正在写回仓库…');
    githubCommit(cfg, 'chore: update playlist via web client', [
      { path:'index.m3u', content },
      { path:'yc.txt', content },
    ]).then(res=> toast('已保存到仓库 ✅ commit ' + (res.short||'ok')))
      .catch(err=> toast('写回失败：' + err.message));
  };
  const s = loadSettings();
  if (s.token){ doCommit(s); } else { openCreds(doCommit); }
}

/* ---------- 持久化 ---------- */
function persist(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(state.channels.map(c=>({name:c.name,group:c.group,logo:c.logo,tvgId:c.tvgId,urls:c.urls})))); }catch(_){} }
function restore(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw);
    state.channels = arr.map(o=>mkChannel(o));
    return state.channels.length > 0;
  }catch(_){ return false; }
}

/* ---------- 加载源 ---------- */
function loadFromText(text, label){
  const chs = parsePlaylist(text);
  if (!chs.length){ toast('未解析到任何频道'); return; }
  state.channels = chs; state.selected.clear(); state.activeId = null;
  persist(); renderAll();
  $('#detail').innerHTML = '<div class="placeholder">← 在中间选择一个频道，查看 EPG 节目单与预览播放</div>';
  toast(`已加载 ${chs.length} 个频道（来源：${label}）`);
}
function loadDefault(){
  toast('正在从 index.m3u 加载…');
  fetch('index.m3u').then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
    .then(t=>loadFromText(t, 'index.m3u')).catch(e=>toast('加载 index.m3u 失败：'+e.message+'（可改用「打开文件」）'));
}
function loadFile(file){
  const reader = new FileReader();
  reader.onload = ()=>loadFromText(reader.result, file.name);
  reader.readAsText(file);
}

/* ---------- modal ---------- */
function closeModal(){ $('#modal-mask').hidden = true; }
$('#modal-close').onclick = closeModal;
$('#modal-mask').onclick = (e)=>{ if (e.target.id==='modal-mask') closeModal(); };

/* ---------- 事件绑定 ---------- */
function bind(){
  $('#btn-load').onclick = ()=>{ if(state.channels.length && !confirm('用 index.m3u 覆盖当前列表？')) return; loadDefault(); };
  $('#btn-file').onclick = ()=>$('#file-input').click();
  $('#file-input').onchange = (e)=>{ if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value=''; };
  $('#btn-paste').onclick = ()=>{
    $('#modal-title').textContent = '粘贴播放列表';
    $('#modal-body').innerHTML = `<div class="field"><label>粘贴 M3U 或中文 IPTV 源文本</label><textarea id="paste-area" style="min-height:220px" placeholder="#EXTM3U 或 组名,#genre# ..."></textarea></div>`;
    $('#modal-foot').innerHTML = `<button id="m-cancel">取消</button><button class="primary" id="m-ok">解析</button>`;
    $('#modal-mask').hidden = false;
    $('#m-cancel').onclick = closeModal;
    $('#m-ok').onclick = ()=>{ const v=$('#paste-area').value.trim(); if(!v){toast('内容为空');return;} loadFromText(v,'粘贴'); closeModal(); };
  };
  $('#btn-epg').onclick = ()=>{
    $('#modal-title').textContent = '加载 EPG (XMLTV)';
    $('#modal-body').innerHTML = `<div class="field"><label>XMLTV 地址（仓库内默认 epg.xml，或任意 URL / 留空加载默认）</label>
      <input id="epg-url" value="${escapeHtml(state.epgUrl)}" placeholder="epg.xml 或 https://.../epg.xml"></div>
      <div class="muted">EPG 会按频道 tvg-id 优先、名称次之自动匹配到节目单。地址以 .gz 结尾时会自动解压。</div>`;
    $('#modal-foot').innerHTML = `<button id="m-cancel">取消</button><button class="primary" id="m-load">加载</button>`;
    $('#modal-mask').hidden = false;
    $('#m-cancel').onclick = closeModal;
    $('#m-load').onclick = ()=>{ const u=$('#epg-url').value.trim()||'epg.xml'; closeModal(); loadEpg(u); };
  };
  $('#btn-export').onclick = openExport;
  $('#btn-save').onclick = saveToRepo;
  $('#btn-theme').onclick = ()=>{
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme', next);
    try{ localStorage.setItem('tvlist_theme', next); }catch(_){}
  };
  $('#search').oninput = (e)=>{ state.search = e.target.value; renderChannels(); };
  $('#sort').onchange = (e)=>{ state.sort = e.target.value; renderChannels(); };
  $('#btn-add').onclick = ()=>openEdit(null);
  $('#btn-del-sel').onclick = ()=>{
    const ids = [...state.selected];
    if (!ids.length){ toast('请先勾选频道'); return; }
    deleteChannels(ids);
  };
  $('#sel-all').onchange = (e)=>{
    const list = visibleChannels();
    if (e.target.checked) list.forEach(c=>state.selected.add(c.id));
    else list.forEach(c=>state.selected.delete(c.id));
    renderChannels();
  };
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !$('#modal-mask').hidden) closeModal(); });
}

function renderAll(){ renderStats(); renderGroups(); renderChannels(); }

/* ---------- 启动 ---------- */
function init(){
  try{ const th = localStorage.getItem('tvlist_theme'); if (th) document.documentElement.setAttribute('data-theme', th); }catch(_){}
  bind();
  if (restore()){ renderAll(); toast('已恢复上次编辑的列表（点击「↻ 加载源」可重新载入 index.m3u）'); }
  else loadDefault();
  // 尝试自动加载 EPG（仓库内 epg.xml.gz 不存在也不影响）
  if (state.epgUrl) loadEpg(state.epgUrl).catch(()=>{});
}
init();
