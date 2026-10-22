import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const H5_CPU_COUNT=2;
export const H5_MEMORY_BYTES=4*1024*1024*1024;
export interface WindowsBudgetOptions {
  evidenceRoot:string;
  executable:string;
  args:readonly string[];
  cwd:string;
  environment?:NodeJS.ProcessEnv;
  timeoutMs:number;
  sampleMs?:number;
  preparedHelper?:PreparedWindowsBudget;
}
export interface WindowsBudgetRecord {
  schema_version:1;
  kind:'WIN32_JOB_OBJECT';
  status:'COMPLETED'|'TIMEOUT'|'FAILED';
  root_exit_code:number|null;
  root_pid:number;
  limits:{cpu_count:2;memory_bytes:number;cpu_rate:number;cpu_rate_flags:5;affinity_mask:string;breakaway_allowed:false;kill_on_close:true};
  elapsed_ms:number;
  cpu_ms:number;
  peak_job_commit_bytes:number;
  max_observed_resident_sum_bytes:number;
  max_observed_private_commit_sum_bytes:number;
  peak_active_processes:number;
  all_sampled_processes_in_job:boolean;
  all_sampled_affinities_within_job:boolean;
  forced_cleanup:boolean;
  cleanup_active_processes:number;
  error_code:string|null;
}
export interface PreparedWindowsBudget {executable:string;sourceSha256:string;executableSha256:string}

function object(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function finiteNumber(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=0;}
export function decodeWindowsBudgetRecord(value:unknown):WindowsBudgetRecord{
  if(!object(value)||value.schema_version!==1||value.kind!=='WIN32_JOB_OBJECT'||!['COMPLETED','TIMEOUT','FAILED'].includes(String(value.status))||!object(value.limits))throw new Error('H5_BUDGET_INVALID_RECORD');
  const limits=value.limits;
  if(limits.cpu_count!==2||limits.memory_bytes!==H5_MEMORY_BYTES||!finiteNumber(limits.cpu_rate)||limits.cpu_rate_flags!==5||typeof limits.affinity_mask!=='string'||limits.breakaway_allowed!==false||limits.kill_on_close!==true)throw new Error('H5_BUDGET_INVALID_LIMITS');
  for(const key of ['root_pid','elapsed_ms','cpu_ms','peak_job_commit_bytes','max_observed_resident_sum_bytes','max_observed_private_commit_sum_bytes','peak_active_processes','cleanup_active_processes'])if(!finiteNumber(value[key]))throw new Error('H5_BUDGET_INVALID_RECORD');
  for(const key of ['all_sampled_processes_in_job','all_sampled_affinities_within_job','forced_cleanup'])if(typeof value[key]!=='boolean')throw new Error('H5_BUDGET_INVALID_RECORD');
  if(value.root_exit_code!==null&&(!finiteNumber(value.root_exit_code)||!Number.isInteger(value.root_exit_code)))throw new Error('H5_BUDGET_INVALID_RECORD');
  if(value.error_code!==null&&typeof value.error_code!=='string')throw new Error('H5_BUDGET_INVALID_RECORD');
  const number=(key:string)=>{const item=value[key];if(!finiteNumber(item))throw new Error('H5_BUDGET_INVALID_RECORD');return item;};
  const bool=(key:string)=>{const item=value[key];if(typeof item!=='boolean')throw new Error('H5_BUDGET_INVALID_RECORD');return item;};
  const status=value.status;if(status!=='COMPLETED'&&status!=='TIMEOUT'&&status!=='FAILED')throw new Error('H5_BUDGET_INVALID_RECORD');
  const rootExit=value.root_exit_code,error=value.error_code;
  if(rootExit!==null&&!finiteNumber(rootExit)||error!==null&&typeof error!=='string')throw new Error('H5_BUDGET_INVALID_RECORD');
  return {schema_version:1,kind:'WIN32_JOB_OBJECT',status,root_exit_code:rootExit,root_pid:number('root_pid'),
    limits:{cpu_count:2,memory_bytes:H5_MEMORY_BYTES,cpu_rate:limits.cpu_rate,cpu_rate_flags:5,affinity_mask:limits.affinity_mask,breakaway_allowed:false,kill_on_close:true},
    elapsed_ms:number('elapsed_ms'),cpu_ms:number('cpu_ms'),peak_job_commit_bytes:number('peak_job_commit_bytes'),
    max_observed_resident_sum_bytes:number('max_observed_resident_sum_bytes'),max_observed_private_commit_sum_bytes:number('max_observed_private_commit_sum_bytes'),
    peak_active_processes:number('peak_active_processes'),all_sampled_processes_in_job:bool('all_sampled_processes_in_job'),all_sampled_affinities_within_job:bool('all_sampled_affinities_within_job'),
    forced_cleanup:bool('forced_cleanup'),cleanup_active_processes:number('cleanup_active_processes'),error_code:error};
}
export function validateWindowsBudgetOptions(options:WindowsBudgetOptions):void{
  if(!isAbsolute(options.evidenceRoot)||!isAbsolute(options.executable)||!isAbsolute(options.cwd))throw new Error('H5_BUDGET_ABSOLUTE_PATH_REQUIRED');
  if(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1000||options.timeoutMs>4*60*60*1000)throw new Error('H5_BUDGET_INVALID_TIMEOUT');
  if(options.sampleMs!==undefined&&(!Number.isSafeInteger(options.sampleMs)||options.sampleMs<50||options.sampleMs>1000))throw new Error('H5_BUDGET_INVALID_SAMPLE_INTERVAL');
  if(options.args.some(value=>value.includes('\0'))||options.executable.includes('\0')||options.cwd.includes('\0'))throw new Error('H5_BUDGET_INVALID_ARGUMENT');
}
async function noSymlinkChain(path:string):Promise<void>{
  let current=resolve(path);
  for(;;){try{if((await lstat(current)).isSymbolicLink())throw new Error('H5_BUDGET_REPARSE_PATH_REFUSED');}catch(error){if(!object(error)||error.code!=='ENOENT')throw error;}
    const parent=resolve(current,'..');if(parent===current)return;current=parent;}
}
async function processExit(executable:string,args:readonly string[],options:{cwd:string;env?:NodeJS.ProcessEnv}):Promise<{code:number;output:string}>{
  return await new Promise((resolvePromise,reject)=>{
    const child=spawn(executable,[...args],{cwd:options.cwd,...(options.env?{env:options.env}:{}),windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
    const append=(data:Buffer)=>{if(output.length<64*1024)output+=data.toString('utf8').slice(0,64*1024-output.length);};
    child.stdout.on('data',append);child.stderr.on('data',append);child.once('error',reject);child.once('close',code=>resolvePromise({code:code??1,output}));
  });
}

// Generated only in task-owned Evidence. No native dependency, persistent service, or machine configuration.
// References: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
// https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information
// https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information
const WINDOWS_HELPER=String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class H5Budget {
  const UInt32 SUSPENDED=4,NO_WINDOW=0x08000000,UNICODE_ENV=0x400,BREAKAWAY=0x01000000;
  const UInt32 AFFINITY=0x10,JOB_MEMORY=0x200,KILL_CLOSE=0x2000;
  const UInt64 MEMORY=4294967296;
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=Int32.MaxValue};
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {public Int64 ProcessTime,JobTime;public UInt32 Flags;public UIntPtr MinWS,MaxWS;public UInt32 ActiveLimit;public UIntPtr Affinity;public UInt32 Priority,Scheduling;}
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {public UInt64 ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes;}
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {public BasicLimit Basic;public IoCounters Io;public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;}
  [StructLayout(LayoutKind.Sequential)] struct CpuRate {public UInt32 Flags,Rate;}
  [StructLayout(LayoutKind.Sequential)] struct Accounting {public Int64 UserTime,KernelTime,ThisUser,ThisKernel;public UInt32 PageFaults,TotalProcesses,ActiveProcesses,TerminatedProcesses;}
  [StructLayout(LayoutKind.Sequential)] struct Security {public Int32 Size;public IntPtr Descriptor;[MarshalAs(UnmanagedType.Bool)] public bool Inherit;}
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {public Int32 Size;public string Reserved,Desktop,Title;public UInt32 X,Y,XSize,YSize,XChars,YChars,Fill,Flags;public UInt16 Show,ReservedSize;public IntPtr ReservedData,StdIn,StdOut,StdErr;}
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr Process,Thread;public UInt32 Pid,Tid;}
  [StructLayout(LayoutKind.Sequential)] struct MemoryStatus {public UInt32 Length,Load;public UInt64 TotalPhysical,AvailablePhysical,TotalCommit,AvailableCommit,TotalVirtual,AvailableVirtual,AvailableExtended;}
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,Int32 kind,IntPtr info,UInt32 length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,Int32 kind,IntPtr info,UInt32 length,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,UInt32 code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,UInt32 code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessAffinityMask(IntPtr process,out UIntPtr allowed,out UIntPtr system);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern UInt32 ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern UInt32 WaitForSingleObject(IntPtr handle,UInt32 milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out UInt32 code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFile(string path,UInt32 access,UInt32 share,ref Security security,UInt32 creation,UInt32 flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,UInt32 flags,IntPtr environment,string cwd,ref Startup startup,out ProcessInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr VirtualAlloc(IntPtr address,UIntPtr size,UInt32 allocation,UInt32 protection);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool VirtualFree(IntPtr address,UIntPtr size,UInt32 type);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
  static void Check(bool ok,string stage){if(!ok)throw new InvalidOperationException(stage+"_WIN32_"+Marshal.GetLastWin32Error());}
  static void Set<T>(IntPtr job,int kind,T value) where T:struct {int length=Marshal.SizeOf(typeof(T));IntPtr ptr=Marshal.AllocHGlobal(length);try{Marshal.StructureToPtr(value,ptr,false);Check(SetInformationJobObject(job,kind,ptr,(UInt32)length),"SET_JOB_"+kind);}finally{Marshal.FreeHGlobal(ptr);}}
  static T Get<T>(IntPtr job,int kind) where T:struct {int length=Marshal.SizeOf(typeof(T));IntPtr ptr=Marshal.AllocHGlobal(length);try{Check(QueryInformationJobObject(job,kind,ptr,(UInt32)length,IntPtr.Zero),"GET_JOB_"+kind);return (T)Marshal.PtrToStructure(ptr,typeof(T));}finally{Marshal.FreeHGlobal(ptr);}}
  static string Quote(string value){StringBuilder b=new StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);slashes=0;continue;}b.Append('\\',slashes);slashes=0;b.Append(c);}b.Append('\\',slashes*2);return b.Append('"').ToString();}
  static StringBuilder Command(string executable,string[] args){StringBuilder b=new StringBuilder(Quote(executable));foreach(string arg in args)b.Append(" ").Append(Quote(arg));return b;}
  static void Write(string path,object value){File.WriteAllText(path,Json.Serialize(value),new UTF8Encoding(false));}
  static UInt64 FirstTwo(UInt64 allowed){UInt64 mask=0;int count=0;for(int i=0;i<64&&count<2;i++){UInt64 bit=1UL<<i;if((allowed&bit)!=0){mask|=bit;count++;}}if(count!=2)throw new InvalidOperationException("TWO_ALLOWED_CPUS_REQUIRED");return mask;}
  static IntPtr OpenOutput(string path){Security s=new Security {Size=Marshal.SizeOf(typeof(Security)),Inherit=true};IntPtr h=CreateFile(path,0x40000000,3,ref s,2,0x80,IntPtr.Zero);if(h==new IntPtr(-1))throw new InvalidOperationException("OPEN_OUTPUT_WIN32_"+Marshal.GetLastWin32Error());return h;}
  static ProcessInfo StartOwned(IntPtr job,string executable,string[] args,string cwd,IntPtr stdout,IntPtr stderr,string proofPath=null){Startup si=new Startup {Size=Marshal.SizeOf(typeof(Startup)),Flags=0x100,StdOut=stdout,StdErr=stderr,StdIn=IntPtr.Zero};ProcessInfo pi;
    Check(CreateProcess(executable,Command(executable,args),IntPtr.Zero,IntPtr.Zero,true,SUSPENDED|NO_WINDOW|UNICODE_ENV,IntPtr.Zero,cwd,ref si,out pi),"CREATE_SUSPENDED");
    try{Check(AssignProcessToJobObject(job,pi.Process),"ASSIGN_SUSPENDED");bool inside;Check(IsProcessInJob(pi.Process,job,out inside)&&inside,"VERIFY_MEMBERSHIP_BEFORE_RESUME");if(proofPath!=null)Write(proofPath,new {schema_version=1,root_pid=pi.Pid,utc=DateTime.UtcNow.ToString("o"),suspended_assigned_before_execution=true,verified_member_before_resume=inside});if(ResumeThread(pi.Thread)==0xffffffff)throw new InvalidOperationException("RESUME_WIN32_"+Marshal.GetLastWin32Error());CloseHandle(pi.Thread);pi.Thread=IntPtr.Zero;return pi;}
    catch{TerminateProcess(pi.Process,125);CloseHandle(pi.Thread);CloseHandle(pi.Process);throw;}
  }
  static List<int> Pids(IntPtr job){const int length=65536;IntPtr ptr=Marshal.AllocHGlobal(length);try{Check(QueryInformationJobObject(job,3,ptr,length,IntPtr.Zero),"GET_JOB_PIDS");int count=Marshal.ReadInt32(ptr,4);if(count<0||count>(length-8)/IntPtr.Size)throw new InvalidOperationException("JOB_PID_INVENTORY_TOO_LARGE");List<int> values=new List<int>();for(int i=0;i<count;i++)values.Add(Marshal.ReadIntPtr(ptr,8+i*IntPtr.Size).ToInt32());return values;}finally{Marshal.FreeHGlobal(ptr);}}
  static object Sample(IntPtr job,Stopwatch timer,UInt64 mask,out UInt64 resident,out UInt64 commits,out bool members,out bool affinities){List<object> values=new List<object>();resident=0;commits=0;members=true;affinities=true;
    foreach(int pid in Pids(job)){try{using(Process p=Process.GetProcessById(pid)){if(p.HasExited)continue;bool inJob;Check(IsProcessInJob(p.Handle,job,out inJob),"SAMPLE_MEMBERSHIP");UIntPtr allowed,system;Check(GetProcessAffinityMask(p.Handle,out allowed,out system),"SAMPLE_AFFINITY");UInt64 affinity=allowed.ToUInt64();members&=inJob;affinities&=(affinity&~mask)==0&&affinity!=0;UInt64 ws=(UInt64)p.WorkingSet64,commit=(UInt64)p.PrivateMemorySize64;resident+=ws;commits+=commit;values.Add(new {pid=pid,image=p.ProcessName,working_set_bytes=ws,private_commit_bytes=commit,affinity_mask=affinity.ToString("x"),in_job=inJob,handles=p.HandleCount,cpu_ms=p.TotalProcessorTime.TotalMilliseconds});}}
      catch(ArgumentException){}catch(InvalidOperationException){try{using(Process p=Process.GetProcessById(pid)){if(!p.HasExited)throw;}}catch(ArgumentException){}}}
    Accounting account=Get<Accounting>(job,1);ExtendedLimit limit=Get<ExtendedLimit>(job,9);return new {utc=DateTime.UtcNow.ToString("o"),elapsed_ms=timer.Elapsed.TotalMilliseconds,cpu_ms=(account.UserTime+account.KernelTime)/10000.0,active_processes=account.ActiveProcesses,total_processes=account.TotalProcesses,peak_job_commit_bytes=limit.PeakJobMemory.ToUInt64(),resident_sum_bytes=resident,private_commit_sum_bytes=commits,processes=values};
  }
  static int Run(string path){Dictionary<string,object> spec=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path));string root=(string)spec["evidenceRoot"],executable=(string)spec["executable"],cwd=(string)spec["cwd"];List<string> arguments=new List<string>();foreach(object value in (System.Collections.IEnumerable)spec["args"])arguments.Add((string)value);string[] args=arguments.ToArray();int interval=Convert.ToInt32(spec["sampleMs"]),timeout=Convert.ToInt32(spec["timeoutMs"]),parentPid=Convert.ToInt32(spec["parentPid"]);
    IntPtr job=IntPtr.Zero,stdout=IntPtr.Zero,stderr=IntPtr.Zero;ProcessInfo pi=new ProcessInfo();Stopwatch timer=Stopwatch.StartNew();string status="FAILED",error=null;UInt32? exit=null;UInt64 maxWS=0,maxPrivate=0,peakCommit=0,mask=0;UInt32 peakActive=0,cleanupActive=0,rate=0;bool members=true,affinities=true,forced=false,configured=false;Accounting finalAccount=new Accounting();
    try{UIntPtr allowed,system;Check(GetProcessAffinityMask(GetCurrentProcess(),out allowed,out system),"GET_ALLOWED_CPUS");mask=FirstTwo(allowed.ToUInt64());int logical=Environment.ProcessorCount;if(logical<2)throw new InvalidOperationException("TWO_SYSTEM_CPUS_REQUIRED");rate=(UInt32)Math.Floor(20000.0/logical);job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CREATE_JOB");
      ExtendedLimit limit=new ExtendedLimit();limit.Basic.Flags=AFFINITY|JOB_MEMORY|KILL_CLOSE;limit.Basic.Affinity=new UIntPtr(mask);limit.JobMemory=new UIntPtr(MEMORY);Set(job,9,limit);Set(job,15,new CpuRate {Flags=5,Rate=rate});ExtendedLimit actual=Get<ExtendedLimit>(job,9);CpuRate actualRate=Get<CpuRate>(job,15);
      if(actual.Basic.Flags!=(AFFINITY|JOB_MEMORY|KILL_CLOSE)||actual.Basic.Affinity.ToUInt64()!=mask||actual.JobMemory.ToUInt64()!=MEMORY||actualRate.Flags!=5||actualRate.Rate!=rate)throw new InvalidOperationException("ENFORCED_LIMIT_READBACK_MISMATCH");configured=true;
      bool parentInJob;Check(IsProcessInJob(GetCurrentProcess(),IntPtr.Zero,out parentInJob),"QUERY_SUPERVISOR_JOB");object parentRate=null;string parentRateError=null;if(parentInJob){try{CpuRate parent=Get<CpuRate>(IntPtr.Zero,15);parentRate=new {flags=parent.Flags,rate=parent.Rate};}catch(InvalidOperationException failure){parentRateError=failure.Message;}}MemoryStatus hostMemory=new MemoryStatus {Length=(UInt32)Marshal.SizeOf(typeof(MemoryStatus))};Check(GlobalMemoryStatusEx(ref hostMemory),"QUERY_HOST_COMMIT");
      Write(Path.Combine(root,"enforced-limits.json"),new {schema_version=1,kind="WIN32_JOB_OBJECT",interop=new {pointer_bytes=IntPtr.Size,basic_limit_bytes=Marshal.SizeOf(typeof(BasicLimit)),extended_limit_bytes=Marshal.SizeOf(typeof(ExtendedLimit)),cpu_rate_bytes=Marshal.SizeOf(typeof(CpuRate))},system_logical_processors=logical,supervisor_allowed_affinity=allowed.ToUInt64().ToString("x"),supervisor_in_any_job=parentInJob,immediate_parent_job_cpu_rate=parentRate,immediate_parent_job_cpu_rate_query_error=parentRateError,parent_quota_semantics="Nested CPU rate is relative to a capped parent; inherited stricter limits can reduce capacity. Two-CPU affinity always remains a hard upper bound, not a reservation.",cpu_count=2,affinity_mask=mask.ToString("x"),cpu_rate=rate,cpu_rate_flags=actualRate.Flags,job_memory_bytes=MEMORY,host_available_commit_bytes=hostMemory.AvailableCommit,memory_semantics="Windows job-wide committed memory; not Linux cgroup/RSS; per-process working-set sum double-counts shared pages. Raw Job PeakJobMemoryUsed can include a rejected commit attempt in this host's RED probes; actual successful allocations and sampled current private commit are retained separately.",breakaway_allowed=false,kill_on_close=true,launch="CREATE_SUSPENDED -> AssignProcessToJobObject -> membership verification -> ResumeThread",job_handle_inherited=false});
      string proofPath=Path.Combine(root,"started.json");Environment.SetEnvironmentVariable("H5_WINDOWS_JOB_PROOF_PATH",proofPath);Environment.SetEnvironmentVariable("H5_WINDOWS_JOB_LIMITS_PATH",Path.Combine(root,"enforced-limits.json"));Environment.SetEnvironmentVariable("H5_WINDOWS_JOB_SAMPLES_PATH",Path.Combine(root,"samples.ndjson"));
      stdout=OpenOutput(Path.Combine(root,"workload.stdout.log"));stderr=OpenOutput(Path.Combine(root,"workload.stderr.log"));pi=StartOwned(job,executable,args,cwd,stdout,stderr,proofPath);
      using(StreamWriter samples=new StreamWriter(Path.Combine(root,"samples.ndjson"),false,new UTF8Encoding(false))){while(true){UInt64 ws,commit;bool member,affinity;object sample=Sample(job,timer,mask,out ws,out commit,out member,out affinity);samples.WriteLine(Json.Serialize(sample));samples.Flush();maxWS=Math.Max(maxWS,ws);maxPrivate=Math.Max(maxPrivate,commit);members&=member;affinities&=affinity;Accounting account=Get<Accounting>(job,1);peakActive=Math.Max(peakActive,account.ActiveProcesses);if(!members||!affinities)throw new InvalidOperationException("JOB_MEMBER_LIMIT_ESCAPE");
          if(WaitForSingleObject(pi.Process,0)==0){UInt32 code;Check(GetExitCodeProcess(pi.Process,out code),"ROOT_EXIT_CODE");exit=code;status="COMPLETED";break;}
          if(timer.ElapsedMilliseconds>=timeout){status="TIMEOUT";error="WORKLOAD_DEADLINE";break;}
          try{using(Process parent=Process.GetProcessById(parentPid)){if(parent.HasExited)throw new InvalidOperationException("SUPERVISOR_PARENT_EXITED");}}catch(ArgumentException){throw new InvalidOperationException("SUPERVISOR_PARENT_EXITED");}
          Thread.Sleep(interval);
      }}
    }catch(Exception failure){error=failure is InvalidOperationException?failure.Message:"NATIVE_HELPER_"+failure.GetType().Name;status="FAILED";}
    finally{if(pi.Thread!=IntPtr.Zero)CloseHandle(pi.Thread);if(pi.Process!=IntPtr.Zero){CloseHandle(pi.Process);pi.Process=IntPtr.Zero;}
      if(job!=IntPtr.Zero){Accounting account=Get<Accounting>(job,1);if(account.ActiveProcesses>0){forced=true;TerminateJobObject(job,124);Stopwatch deadline=Stopwatch.StartNew();while(Get<Accounting>(job,1).ActiveProcesses>0&&deadline.ElapsedMilliseconds<10000)Thread.Sleep(25);}finalAccount=Get<Accounting>(job,1);cleanupActive=finalAccount.ActiveProcesses;peakCommit=Get<ExtendedLimit>(job,9).PeakJobMemory.ToUInt64();CloseHandle(job);job=IntPtr.Zero;}
      if(stdout!=IntPtr.Zero)CloseHandle(stdout);if(stderr!=IntPtr.Zero)CloseHandle(stderr);timer.Stop();
      Write(Path.Combine(root,"resource-budget.json"),new {schema_version=1,kind="WIN32_JOB_OBJECT",status=status,root_exit_code=exit,root_pid=pi.Pid,limits=new {cpu_count=2,memory_bytes=MEMORY,cpu_rate=rate,cpu_rate_flags=5,affinity_mask=mask.ToString("x"),breakaway_allowed=false,kill_on_close=true},configured=configured,elapsed_ms=timer.Elapsed.TotalMilliseconds,cpu_ms=(finalAccount.UserTime+finalAccount.KernelTime)/10000.0,peak_job_commit_bytes=peakCommit,max_observed_resident_sum_bytes=maxWS,max_observed_private_commit_sum_bytes=maxPrivate,peak_active_processes=peakActive,all_sampled_processes_in_job=members,all_sampled_affinities_within_job=affinities,forced_cleanup=forced,cleanup_active_processes=cleanupActive,error_code=error});
    }
    return status=="COMPLETED"&&exit==0&&cleanupActive==0&&configured?0:1;
  }
  static int Probe(string kind,string root){Directory.CreateDirectory(root);string output=Path.Combine(root,"probe.json");
    if(kind=="cpu"){Stopwatch wall=Stopwatch.StartNew();TimeSpan start=Process.GetCurrentProcess().TotalProcessorTime;List<Thread> threads=new List<Thread>();for(int i=0;i<8;i++){Thread t=new Thread(()=>{UInt64 value=1;while(wall.ElapsedMilliseconds<6000)value=unchecked(value*2862933555777941757UL+3037000493UL);GC.KeepAlive(value);});threads.Add(t);t.Start();}foreach(Thread t in threads)t.Join();double cpu=(Process.GetCurrentProcess().TotalProcessorTime-start).TotalMilliseconds;Write(output,new {probe="demand_8_cpu_threads",requested_cores=8,wall_ms=wall.Elapsed.TotalMilliseconds,cpu_ms=cpu,observed_cores=cpu/wall.Elapsed.TotalMilliseconds,unbounded_demand_assertion="RED_EXPECTED"});return 0;}
    if(kind=="memory-single"||kind=="memory-total"||kind=="memory-child"){UInt64 requested=kind=="memory-single"?MEMORY+64*1024*1024:2304UL*1024*1024;IntPtr allocation=VirtualAlloc(IntPtr.Zero,new UIntPtr(requested),0x3000,4);int win32=Marshal.GetLastWin32Error();try{if(kind=="memory-total"){if(allocation==IntPtr.Zero)throw new InvalidOperationException("FIRST_UNDER_LIMIT_ALLOCATION_FAILED");string child=Path.Combine(root,"child");Directory.CreateDirectory(child);ProcessStartInfo si=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,Command("",new[]{"probe","memory-child",child}).ToString().Substring(3));si.UseShellExecute=false;si.CreateNoWindow=true;using(Process p=Process.Start(si)){p.WaitForExit();Write(output,new {probe=kind,pid=Process.GetCurrentProcess().Id,first_committed_bytes=requested,child_pid=p.Id,child_exit_code=p.ExitCode,aggregate_requested_bytes=requested*2,unbounded_demand_assertion="RED_EXPECTED"});return p.ExitCode;}}
        Write(output,new {probe=kind,pid=Process.GetCurrentProcess().Id,requested_bytes=requested,allocation_succeeded=allocation!=IntPtr.Zero,win32_error=win32,unbounded_demand_assertion="RED_EXPECTED"});Thread.Sleep(400);return allocation==IntPtr.Zero?0:2;
      }finally{if(allocation!=IntPtr.Zero)VirtualFree(allocation,UIntPtr.Zero,0x8000);}}
    if(kind=="hold"){Write(output,new {probe=kind,pid=Process.GetCurrentProcess().Id});Thread.Sleep(30000);return 0;}
    if(kind=="escape"||kind=="close"){string exe=Process.GetCurrentProcess().MainModule.FileName;Startup si=new Startup {Size=Marshal.SizeOf(typeof(Startup))};ProcessInfo pi;
      if(kind=="escape"){bool ok=CreateProcess(exe,Command(exe,new[]{"probe","hold",Path.Combine(root,"escaped")}),IntPtr.Zero,IntPtr.Zero,false,BREAKAWAY|NO_WINDOW,IntPtr.Zero,root,ref si,out pi);int win32=Marshal.GetLastWin32Error();if(ok){TerminateProcess(pi.Process,125);CloseHandle(pi.Thread);CloseHandle(pi.Process);}Write(output,new {probe=kind,breakaway_create_succeeded=ok,win32_error=win32,unbounded_escape_assertion="RED_EXPECTED"});return ok?2:0;}
      IntPtr nested=CreateJobObject(IntPtr.Zero,null);Check(nested!=IntPtr.Zero,"PROBE_CREATE_JOB");ExtendedLimit limit=new ExtendedLimit();limit.Basic.Flags=KILL_CLOSE;Set(nested,9,limit);pi=StartOwned(nested,exe,new[]{"probe","hold",Path.Combine(root,"held")},root,IntPtr.Zero,IntPtr.Zero);CloseHandle(nested);bool stopped=WaitForSingleObject(pi.Process,5000)==0;CloseHandle(pi.Process);Write(output,new {probe=kind,child_pid=pi.Pid,killed_on_last_handle_close=stopped});return stopped?0:2;
    }
    throw new InvalidOperationException("UNKNOWN_PROBE");
  }
  public static int Main(string[] args){try{if(args.Length==2&&args[0]=="run")return Run(args[1]);if(args.Length==3&&args[0]=="probe")return Probe(args[1],args[2]);return 2;}catch(Exception error){Console.Error.WriteLine("H5_BUDGET_NATIVE_"+error.GetType().Name);return 1;}}
}
`;

async function readPreparedWindowsBudget(prepared:PreparedWindowsBudget,sourceSha256:string):Promise<{source:Buffer;executable:Buffer;origin:string;executableSha256:string}>{
  if(!object(prepared)||typeof prepared.executable!=='string'||typeof prepared.sourceSha256!=='string'||typeof prepared.executableSha256!=='string')throw new Error('H5_BUDGET_PREPARED_IDENTITY_INVALID');
  if(!isAbsolute(prepared.executable))throw new Error('H5_BUDGET_ABSOLUTE_PATH_REQUIRED');
  const executable=resolve(prepared.executable),source=join(dirname(executable),'H5ResourceBudget.cs');
  await noSymlinkChain(executable);await noSymlinkChain(source);
  if(!(await lstat(executable)).isFile()||!(await lstat(source)).isFile())throw new Error('H5_BUDGET_PREPARED_FILE_REQUIRED');
  const sourceBytes=await readFile(source);
  if(!sourceBytes.equals(Buffer.from(WINDOWS_HELPER))||createHash('sha256').update(sourceBytes).digest('hex')!==prepared.sourceSha256||prepared.sourceSha256!==sourceSha256)throw new Error('H5_BUDGET_PREPARED_SOURCE_MISMATCH');
  // Hash and copy this same read, rather than reopening a path after validation.
  const executableBytes=await readFile(executable),executableSha256=createHash('sha256').update(executableBytes).digest('hex');
  if(executableSha256!==prepared.executableSha256)throw new Error('H5_BUDGET_PREPARED_EXECUTABLE_MISMATCH');
  return {source:sourceBytes,executable:executableBytes,origin:executable,executableSha256};
}

export async function prepareWindowsResourceBudget(evidenceRoot:string,preparedHelper?:PreparedWindowsBudget):Promise<PreparedWindowsBudget>{
  if(process.platform!=='win32')throw new Error('H5_BUDGET_WINDOWS_REQUIRED');
  if(!isAbsolute(evidenceRoot))throw new Error('H5_BUDGET_ABSOLUTE_PATH_REQUIRED');
  await noSymlinkChain(evidenceRoot);await mkdir(evidenceRoot,{recursive:true});
  const sourceSha256=createHash('sha256').update(WINDOWS_HELPER).digest('hex');
  const directory=join(evidenceRoot,`native-${sourceSha256.slice(0,16)}`);await mkdir(directory,{recursive:true});
  const source=join(directory,'H5ResourceBudget.cs'),executable=join(directory,'H5ResourceBudget.exe');
  if(preparedHelper!==undefined){
    const cached=await readPreparedWindowsBudget(preparedHelper,sourceSha256);
    await noSymlinkChain(directory);
    await writeFile(source,cached.source,{flag:'wx'});await writeFile(executable,cached.executable,{flag:'wx'});
    await writeFile(join(directory,'native-identity.json'),JSON.stringify({source_sha256:sourceSha256,executable_sha256:cached.executableSha256,node:process.version,
      prepared_from:{executable:cached.origin,source_sha256:sourceSha256,executable_sha256:cached.executableSha256}},null,2),{flag:'wx'});
    return {executable,sourceSha256,executableSha256:cached.executableSha256};
  }
  try{await writeFile(source,WINDOWS_HELPER,{flag:'wx'});}catch(error){if(!object(error)||error.code!=='EEXIST'||await readFile(source,'utf8')!==WINDOWS_HELPER)throw error;}
  try{await lstat(executable);}catch(error){if(!object(error)||error.code!=='ENOENT')throw error;
    const compiler=join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
    const result=await processExit(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/reference:System.Web.Extensions.dll',`/out:${executable}`,source],{cwd:directory});
    await writeFile(join(directory,'compile.log'),result.output);if(result.code!==0)throw new Error('H5_BUDGET_NATIVE_COMPILE_FAILED');
  }
  const executableSha256=createHash('sha256').update(await readFile(executable)).digest('hex');
  await writeFile(join(directory,'native-identity.json'),JSON.stringify({source_sha256:sourceSha256,executable_sha256:executableSha256,node:process.version},null,2));
  return {executable,sourceSha256,executableSha256};
}

export async function runWindowsResourceBudget(options:WindowsBudgetOptions):Promise<WindowsBudgetRecord>{
  validateWindowsBudgetOptions(options);if(process.platform!=='win32')throw new Error('H5_BUDGET_WINDOWS_REQUIRED');
  await noSymlinkChain(options.evidenceRoot);await mkdir(options.evidenceRoot);
  const prepared=await prepareWindowsResourceBudget(join(options.evidenceRoot,'native'),options.preparedHelper);
  const spec=join(options.evidenceRoot,'launch.json');
  await writeFile(spec,JSON.stringify({evidenceRoot:resolve(options.evidenceRoot),executable:options.executable,args:options.args,cwd:options.cwd,timeoutMs:options.timeoutMs,sampleMs:options.sampleMs??250,parentPid:process.pid}));
  const result=await processExit(prepared.executable,['run',spec],{cwd:options.cwd,...(options.environment?{env:options.environment}:{})});
  await writeFile(join(options.evidenceRoot,'supervisor.log'),result.output);
  const record=decodeWindowsBudgetRecord(JSON.parse(await readFile(join(options.evidenceRoot,'resource-budget.json'),'utf8')));
  if(record.cleanup_active_processes!==0||!record.all_sampled_processes_in_job||!record.all_sampled_affinities_within_job)throw new Error('H5_BUDGET_ENFORCEMENT_OR_CLEANUP_FAILED');
  return record;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2);const marker=args.indexOf('--');
  if(args[0]!=='run'||marker<0)throw new Error('Usage: h5-resource-budget.mjs run --evidence-root <new directory> --timeout-ms <ms> -- <absolute executable> [...args]');
  const flag=(name:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
  const evidenceRoot=flag('--evidence-root'),executable=args[marker+1];
  if(!evidenceRoot||!executable)throw new Error('H5_BUDGET_ARGUMENT_REQUIRED');
  const record=await runWindowsResourceBudget({evidenceRoot,executable,args:args.slice(marker+2),cwd:resolve(flag('--cwd')??process.cwd()),timeoutMs:Number(flag('--timeout-ms')??3600000)});
  process.stdout.write(`${JSON.stringify({status:record.status,root_exit_code:record.root_exit_code,cleanup_active_processes:record.cleanup_active_processes,evidenceRoot})}\n`);
  if(record.status!=='COMPLETED'||record.root_exit_code!==0)process.exitCode=1;
}
