/**
 * 重启用小助手：一个独立的 launcher 脚本，先等旧进程释放端口，
 * 再用「与当前进程完全相同的启动参数」重新拉起 dsh web。
 *
 * 为什么必须这样绕一圈：
 *  dsh web 的 node 进程自己就是服务宿主，`process.exit()` 之后端口立刻空出来，
 *  但没有任何东西会把它重新拉起来 —— 启动器脚本（dsh-start.ps1）跑完就直接退出，
 *  于是用户看到的现象就是「关了宿主机并没有重启」。宿主插件又没有 HMR
 *  （cordis-plugin-loader 的 exit() 是空实现），改宿主代码只能整进程重开。
 *  所以由被重启的进程在退出前先 spawn 一个游离的 launcher：它比父进程活得久，
 *  等端口空出来后自己把 dsh web 拉起来。
 */
const LAUNCHER_SOURCE = `import { spawn } from 'node:child_process'
import net from 'node:net'

const [portText, cwd, host, nodeExe, ...args] = process.argv.slice(2)
const port = Number(portText)

/** 端口上还有人在听吗（连一下就断，不发数据）。 */
function listening() {
  return new Promise((done) => {
    const socket = net.connect({ host, port })
    const finish = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      done(value)
    }
    socket.setTimeout(1200, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

// 旧进程退出、端口释放都需要一点时间；最多等 30 秒，超时也照样尝试启动
// （万一旧进程卡在关闭 socket 上，宁可让新进程报端口占用，也别躺平不拉起）。
const deadline = Date.now() + 30000
while (Date.now() < deadline) {
  if (!(await listening())) break
  await new Promise((done) => setTimeout(done, 200))
}

const child = spawn(nodeExe, args, {
  cwd,
  env: process.env,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
})
child.unref()
`

/** 选一个「端口探活」的 host：监听在具体地址上就用它，通配地址一律走回环。 */
function probeHost(ctx) {
  try {
    const host = ctx?.webServer?.host
    if (typeof host === 'string' && host !== '' && host !== '0.0.0.0' && host !== '::') return host
  } catch {
    /* 拿不到就用回环 */
  }
  return '127.0.0.1'
}

function listeningPort(ctx) {
  try {
    const port = ctx?.webServer?.port
    if (Number.isInteger(port) && port > 0) return port
  } catch {
    /* 拿不到就退回默认端口 */
  }
  return 8848
}
export { LAUNCHER_SOURCE, probeHost, listeningPort }
