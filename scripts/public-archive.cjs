"use strict";

function mergePublicArchive(currentEntries,previousEntries,pageExists){
  const currentBySource=new Map(currentEntries.filter(entry=>entry.source_url).map(entry=>[entry.source_url,entry.id]));
  const revisionBases=new Set(currentEntries.filter(entry=>entry.id.includes("_rev_")).map(entry=>entry.id.split("_rev_")[0]));
  const byId=new Map();
  for(const entry of previousEntries||[]){
    const id=String(entry?.id||"");
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(id)||!Array.isArray(entry.categories)||!pageExists(id))continue;
    if(entry.source_url&&currentBySource.has(entry.source_url)&&currentBySource.get(entry.source_url)!==id)continue;
    if(revisionBases.has(id.split("_rev_")[0]))continue;
    byId.set(id,entry);
  }
  for(const entry of currentEntries)byId.set(entry.id,entry);
  return [...byId.values()].sort((a,b)=>String(b.published||"").localeCompare(String(a.published||""))||a.id.localeCompare(b.id));
}

module.exports={mergePublicArchive};
