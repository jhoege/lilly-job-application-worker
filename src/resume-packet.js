import {serviceDriveToken} from './google-answers.js';
export async function exportResumePacket(job,{getToken=serviceDriveToken,fetcher=fetch}={}){
 const id=String(job.resumeVersion||'').match(/https:\/\/(?:docs\.google\.com\/document\/d|drive\.google\.com\/file\/d)\/([A-Za-z0-9_-]+)/)?.[1];
 if(!id)throw Error('Exact approved resume version has no supported Drive document URL');
 const token=await getToken(),headers={Authorization:'Bearer '+token};
 const meta=await fetcher('https://www.googleapis.com/drive/v3/files/'+id+'?fields=name,mimeType',{headers,signal:AbortSignal.timeout(12000)});
 if(!meta.ok)throw Error('Approved resume read failed HTTP '+meta.status);
 const file=await meta.json();
 const endpoint=file.mimeType==='application/vnd.google-apps.document'?'/export?mimeType=application%2Fpdf':file.mimeType==='application/pdf'?'?alt=media':null;
 if(!endpoint)throw Error('Approved resume must be a Google Doc or PDF');
 const r=await fetcher('https://www.googleapis.com/drive/v3/files/'+id+endpoint,{headers,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Approved resume PDF export failed HTTP '+r.status);
 const buffer=Buffer.from(await r.arrayBuffer());
 if(buffer.length<2000||buffer.subarray(0,5).toString()!=='%PDF-')throw Error('Approved resume export is not a usable PDF');
 const name=('Lilly-'+job.id+'-'+file.name).replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,155)+'.pdf';
 return {name,mimeType:'application/pdf',buffer,sourceId:id};
}
