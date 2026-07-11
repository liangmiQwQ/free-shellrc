// This standalone script is embedded in profiles so cleanup still works after the package is uninstalled.
export const CLEANUP_SCRIPT = String.raw`
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const profile=process.argv[1],startMarker=process.argv[2],endMarker=process.argv[3];
const link=fs.lstatSync(profile).isSymbolicLink(),target=link?fs.realpathSync(profile):profile,original=fs.readFileSync(target),stat=fs.statSync(target);
let encoding="utf8",offset=0;
if(original.subarray(0,3).equals(Buffer.from([239,187,191]))){encoding="utf8-bom";offset=3}else if(original.subarray(0,2).equals(Buffer.from([255,254]))){encoding="utf16le";offset=2}else if(original.subarray(0,2).equals(Buffer.from([254,255]))){encoding="utf16be";offset=2}
const decoderEncoding=encoding==="utf8-bom"?"utf8":encoding==="utf16le"?"utf-16le":encoding==="utf16be"?"utf-16be":encoding,decoder=new TextDecoder(decoderEncoding,{fatal:true}),text=decoder.decode(original.subarray(offset)),lines=[];
let lineStart=0,match,re=/\r\n|\n|\r/g;
while((match=re.exec(text))) {lines.push({content:text.slice(lineStart,match.index),contentEnd:match.index,end:match.index+match[0].length,start:lineStart});lineStart=match.index+match[0].length}
if(lineStart<text.length)lines.push({content:text.slice(lineStart),contentEnd:text.length,end:text.length,start:lineStart});
const blocks=[];let opening;
for(const line of lines){if(line.content===startMarker){if(opening)process.exit(0);opening=line}else if(line.content===endMarker){if(!opening)process.exit(0);blocks.push({start:opening,end:line});opening=undefined}}
if(opening||blocks.length===0)process.exit(0);
let updated=text;
for(const block of blocks.reverse()){const previous=lines.find(line=>line.end===block.start.start),from=previous?(previous.content===""?previous.start:previous.contentEnd):block.start.start,to=block.end.end<text.length&&previous&&previous.content!==""?block.end.contentEnd:block.end.end;updated=updated.slice(0,from)+updated.slice(to)}
let content=Buffer.from(updated,encoding.startsWith("utf16")?"utf16le":"utf8");
if(encoding==="utf16be")for(let index=0;index<content.length;index+=2){const first=content[index];content[index]=content[index+1];content[index+1]=first}
if(encoding==="utf8-bom")content=Buffer.concat([Buffer.from([239,187,191]),content]);else if(encoding==="utf16le")content=Buffer.concat([Buffer.from([255,254]),content]);else if(encoding==="utf16be")content=Buffer.concat([Buffer.from([254,255]),content]);
if(!fs.readFileSync(target).equals(original))process.exit(0);
const temporary=path.join(path.dirname(target),".free-shellrc-"+crypto.randomBytes(8).toString("hex"));
try{fs.writeFileSync(temporary,content,{flag:"wx",mode:stat.mode});fs.chmodSync(temporary,stat.mode);if(!fs.readFileSync(target).equals(original))throw new Error("Concurrent profile change");fs.renameSync(temporary,target)}finally{try{fs.unlinkSync(temporary)}catch{}}
`.trim()
