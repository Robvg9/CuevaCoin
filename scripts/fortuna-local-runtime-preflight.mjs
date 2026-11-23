import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function emit(key, value) {
  console.log('PREFLIGHT_' + key + '=' + value);
}

function findExecutable(names) {
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of entries) {
    for (const name of names) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

emit('HOST_RAM_TOTAL_MB', Math.round(os.totalmem() / 1024 / 1024));
emit('HOST_RAM_FREE_MB', Math.round(os.freemem() / 1024 / 1024));
emit('HOST_PLATFORM', process.platform + '-' + process.arch);
emit('NODE_VERSION', process.version);

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const drive = path.parse(workspace).root.replace(/\\$/, '');
emit('WORKSPACE_DRIVE', drive || 'UNKNOWN');

const ps = findExecutable(['powershell.exe', 'powershell']);
if (ps) {
  const diskQuery = "(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='" + drive + "'\").FreeSpace";
  const disk = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', diskQuery], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  const bytes = Number((disk.stdout || '').trim());
  if (disk.status === 0 && Number.isFinite(bytes) && bytes > 0) {
    emit('WORKSPACE_DISK_FREE_MB', Math.round(bytes / 1024 / 1024));
  } else {
    emit('WORKSPACE_DISK_FREE_MB', 'UNKNOWN');
    emit('DISK_QUERY_DIAGNOSTIC', (disk.stderr || (disk.error && disk.error.message) || 'query unavailable').trim().slice(0, 180));
  }
} else {
  emit('WORKSPACE_DISK_FREE_MB', 'UNKNOWN');
  emit('POWERSHELL', 'NOT_FOUND');
}

const docker = findExecutable(['docker.exe', 'docker']);
if (!docker) {
  emit('DOCKER_CLI', 'NOT_INSTALLED');
  emit('DOCKER_ENGINE', 'NOT_CHECKED');
} else {
  emit('DOCKER_CLI', 'INSTALLED');
  const version = spawnSync(docker, ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8', timeout: 12000, windowsHide: true
  });
  const serverVersion = (version.stdout || '').trim();
  if (version.status === 0 && serverVersion) {
    emit('DOCKER_ENGINE', 'AVAILABLE');
    emit('DOCKER_SERVER_VERSION', serverVersion);
    const info = spawnSync(docker, ['info', '--format', '{{.MemTotal}}'], {
      encoding: 'utf8', timeout: 12000, windowsHide: true
    });
    const memory = Number((info.stdout || '').trim());
    if (info.status === 0 && Number.isFinite(memory) && memory > 0) {
      emit('DOCKER_MEMORY_MB', Math.round(memory / 1024 / 1024));
    }
  } else {
    emit('DOCKER_ENGINE', 'UNAVAILABLE');
    emit('DOCKER_DIAGNOSTIC', (version.stderr || (version.error && version.error.message) || 'engine unavailable').trim().slice(0, 180));
  }
}

const supabase = findExecutable(['supabase.exe', 'supabase.cmd', 'supabase']);
if (!supabase) {
  emit('SUPABASE_CLI', 'NOT_INSTALLED');
} else {
  const useShell = supabase.toLowerCase().endsWith('.cmd');
  const version = spawnSync(supabase, ['--version'], {
    encoding: 'utf8', timeout: 10000, windowsHide: true, shell: useShell
  });
  emit('SUPABASE_CLI', version.status === 0 ? 'INSTALLED' : 'FOUND_BUT_FAILED');
  if (version.status === 0) emit('SUPABASE_CLI_VERSION', (version.stdout || '').trim());
}

emit('SIDE_EFFECTS', 'NONE');
emit('SERVICES_STARTED', 'NO');
emit('CONTAINERS_CREATED', 'NO');
emit('IMAGES_DOWNLOADED', 'NO');
