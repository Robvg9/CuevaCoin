/** CuevaCoin — historial financiero general de solo lectura para administración. */
import { getLocalDateRange } from '../../utils/local-date-range.js?v=153';
const HISTORY_PAGE_SIZE=20;
let historyOffset=0,historyHasMore=false,historyLoading=false,historyToken=0,historyDebounce=null;
function histText(tag,cls,value){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=value==null?'':String(value);return el;}
function isAdmin(){try{return JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual')||'null')?.esAdmin===true;}catch(_){return false;}}
function movementInfo(tx){const n=Number(tx.cantidad||0);if(tx.tipo==='deposito_admin'){const bonus=String(tx.motivo||'').toLowerCase().startsWith('bono:');return{key:bonus?'bono':'salario',label:bonus?'Bono':'Salario',icon:bonus?'🎁':'💵'};}if(tx.tipo==='retiro_admin')return n<0?{key:'ajuste',label:'Descuento admin',icon:'➖'}:{key:'ajuste',label:'Ajuste admin',icon:'⚖️'};if(tx.tipo==='retiro')return{key:'retiro',label:'Retiro',icon:'🏧'};if(tx.tipo==='transferencia')return n>=0?{key:'transferencia',label:'Transferencia recibida',icon:'💰'}:{key:'transferencia',label:'Transferencia enviada',icon:'📤'};return{key:'otro',label:String(tx.tipo||'Movimiento').replaceAll('_',' '),icon:'📋'};}
function personName(p){return p?.nombre||p?.usuario||'';}
function applyHistoryFilters(q){
 const type=document.getElementById('admin-general-history-type')?.value||'todos',from=document.getElementById('admin-general-history-from')?.value||'',to=document.getElementById('admin-general-history-to')?.value||'',search=(document.getElementById('admin-general-history-search')?.value||'').trim();
 if(type==='salarios')q=q.eq('tipo','deposito_admin').or('motivo.is.null,motivo.not.ilike.Bono:%');else if(type==='bonos')q=q.eq('tipo','deposito_admin').ilike('motivo','Bono:%');else if(type==='ajustes')q=q.eq('tipo','retiro_admin');else if(type==='retiros')q=q.eq('tipo','retiro');else if(type==='transferencias')q=q.eq('tipo','transferencia');
 const dateRange=getLocalDateRange(from,to);if(dateRange.start)q=q.gte('creado_en',dateRange.start);if(dateRange.endExclusive)q=q.lt('creado_en',dateRange.endExclusive);
 if(search)q=q.ilike('motivo','%'+search.replace(/[%_]/g,'\\$&')+'%');return q;
}
function historyCard(tx){
 const info=movementInfo(tx),amount=Number(tx.cantidad||0),date=new Date(tx.creado_en),card=document.createElement('article');card.className='tx-card admin-general-history-card';
 const header=document.createElement('div');header.className='tx-card-header';const title=document.createElement('div');title.className='tx-card-titulo';
 title.append(histText('span','tx-card-tipo '+info.key,info.label),histText('span','tx-card-fecha',Number.isNaN(date.getTime())?'Fecha desconocida':date.toLocaleString()));
 const signed=(amount>0?'+':amount<0?'−':'')+'$'+Math.abs(amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 header.append(histText('span','tx-card-icono tx-card-icono-'+info.key,info.icon),title,histText('strong','tx-card-monto '+(amount>=0?'positivo':'negativo'),signed));card.appendChild(header);
 const details=document.createElement('div');details.className='admin-general-history-details';details.appendChild(histText('span','admin-history-detail-worker','Trabajadora: '+(personName(tx.trabajadora)||'Cuenta no disponible')));
 const admin=personName(tx.admin),other=personName(tx.contraparte);if(admin)details.appendChild(histText('span','admin-history-detail-admin','Por: '+admin));if(other)details.appendChild(histText('span','admin-history-detail-counterpart','Contraparte: '+other));if(tx.motivo)details.appendChild(histText('span','admin-history-motivo','Motivo: '+tx.motivo));card.appendChild(details);return card;
}
function updateHistoryMore(){const b=document.getElementById('admin-general-history-more'),s=document.getElementById('admin-general-history-status');if(b){b.classList.toggle('hidden',!historyHasMore);b.disabled=historyLoading;b.textContent=historyLoading?'Cargando…':'Ver más';}if(s&&historyLoading)s.textContent='Cargando movimientos…';}
export async function cargarHistorialGeneral(options={}){
 if(!isAdmin()){window.showToast?.('Solo el administrador puede consultar el historial general.',3000);return;}
 const append=options.append===true,list=document.getElementById('admin-general-history-list'),empty=document.getElementById('admin-general-history-empty');if(!list||!window.supabaseClient)return;if(append&&(historyLoading||!historyHasMore))return;
 if(!append){historyToken++;historyOffset=0;historyHasMore=false;list.replaceChildren();}
 const token=historyToken;historyLoading=true;updateHistoryMore();
 try{
  let q=window.supabaseClient.from('transacciones').select('id,usuario_id,admin_id,contraparte_id,tipo,cantidad,motivo,creado_en,trabajadora:perfiles!transacciones_usuario_id_fkey(nombre, usuario),admin:perfiles!transacciones_admin_id_fkey(nombre, usuario),contraparte:perfiles!transacciones_contraparte_id_fkey(nombre, usuario)').order('creado_en',{ascending:false}).order('id',{ascending:false}).range(historyOffset,historyOffset+HISTORY_PAGE_SIZE-1);
  const {data,error}=await applyHistoryFilters(q);if(token!==historyToken)return;if(error)throw error;
  const rows=data||[];rows.forEach(row=>list.appendChild(historyCard(row)));historyOffset+=rows.length;historyHasMore=rows.length===HISTORY_PAGE_SIZE;
  list.classList.toggle('hidden',historyOffset===0);if(empty)empty.classList.toggle('hidden',historyOffset>0);
 }catch(error){if(token===historyToken){console.error('[CuevaCoin] No se pudo cargar el historial general:',error);if(!append){list.replaceChildren();if(empty){empty.textContent='No se pudo cargar el historial general.';empty.classList.remove('hidden');}}}}
 finally{if(token===historyToken){historyLoading=false;updateHistoryMore();const s=document.getElementById('admin-general-history-status');if(s)s.textContent=historyOffset?historyOffset+' movimientos cargados':'';}}
}
export function debounceHistorialGeneral(){clearTimeout(historyDebounce);historyDebounce=setTimeout(()=>cargarHistorialGeneral(),350);}
if(typeof window!=='undefined'){window.cargarHistorialGeneral=cargarHistorialGeneral;window.debounceHistorialGeneral=debounceHistorialGeneral;}
