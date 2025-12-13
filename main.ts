import { App, Notice, Plugin, PluginSettingTab, Setting, StatusBarItem } from "obsidian";
import { spawn } from "child_process";

/** 单个 Remote 配置 */
interface RcloneRemote {
	/** rclone config 中的 remote 名称，例如 onedrive */
	name: string;
	/** 远程路径，允许带冒号（如 onedrive:my-vault），也可只填相对路径 */
	path: string;
	/** 是否启用该 remote */
	enable: boolean;
}

/**
 * 插件设置接口（支持多目的地）
 */
interface ObsidianRcloneBridgeSettings {
	/** rclone 可执行文件的绝对路径 */
	rclonePath: string;
	/** 多目的地配置列表 */
	remotes: RcloneRemote[];
}

const DEFAULT_SETTINGS: ObsidianRcloneBridgeSettings = {
	rclonePath: "",
	remotes: [],
};

/** 状态栏展示文本 */
type SyncStatus = "就绪" | "正在同步..." | "同步成功" | "同步失败";

export default class ObsidianRcloneBridgePlugin extends Plugin {
	settings!: ObsidianRcloneBridgeSettings;
	statusBar: StatusBarItem | null = null;
	isSyncing = false;

	async onload() {
		await this.loadSettings();

		// Ribbon 按钮：立即同步
		this.addRibbonIcon("cloud", "立即同步", () => {
			this.handleSync();
		});

		// 状态栏
		this.statusBar = this.addStatusBarItem();
		this.updateStatus("就绪");

		// 设置面板
		this.addSettingTab(new RcloneSettingTab(this.app, this));
	}

	onunload() {
		// 卸载时无需特殊清理
	}

	/** 统一处理同步流程与状态/提示（多目的地顺序执行） */
	private async handleSync() {
		if (this.isSyncing) {
			new Notice("已有同步任务正在进行，请稍候...");
			return;
		}

		this.isSyncing = true;
		this.updateStatus("正在同步...");

		try {
			const enabledRemotes = (this.settings.remotes || []).filter((r) => r.enable);
			if (enabledRemotes.length === 0) {
				throw new Error("请在设置中至少启用一个 Remote。");
			}

			const overallStart = Date.now();
			const results: Array<{
				remote: RcloneRemote;
				success: boolean;
				summary: string;
			}> = [];

			for (const remote of enabledRemotes) {
				try {
					const summary = await this.runRcloneSync(remote);
					results.push({ remote, success: true, summary });
				} catch (err) {
					console.error("[Obsidian Rclone Bridge]", err);
					const message = err instanceof Error ? err.message : String(err);
					results.push({ remote, success: false, summary: `失败: ${message}` });
				}
			}

			const durationSec = ((Date.now() - overallStart) / 1000).toFixed(1);
			const allSuccess = results.every((r) => r.success);
			this.updateStatus(allSuccess ? "同步成功" : "同步失败");

			const lines = [
				`同步完成 (${durationSec}s)`,
				...results.map((r) => `${r.remote.name || "(未命名)"}: ${r.summary}`),
			];
			new Notice(lines.join("\n"));
		} catch (err) {
			console.error("[Obsidian Rclone Bridge]", err);
			this.updateStatus("同步失败");
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`同步失败: ${message}`);
		} finally {
			this.isSyncing = false;
		}
	}

	/** 更新状态栏显示 */
	private updateStatus(status: SyncStatus) {
		if (!this.statusBar) return;
		this.statusBar.setText(`Rclone: ${status}`);
	}

	/**
	 * 调用 rclone bisync 进行双向同步（单个 remote）
	 * 返回解析后的摘要信息
	 */
	async runRcloneSync(remote: RcloneRemote): Promise<string> {
		const { rclonePath } = this.settings;

		if (!rclonePath) {
			throw new Error("请在设置中填写 rclone 可执行文件的绝对路径。");
		}

		const vaultPath = (this.app.vault.adapter as any).getBasePath?.();
		if (!vaultPath) {
			throw new Error("无法获取当前 Vault 的本地路径（仅桌面端支持）。");
		}

		// 允许用户直接写完整 remotePath（含冒号），否则拼接 remoteName
		const remoteTarget = remote.path.includes(":")
			? remote.path
			: remote.name
				? `${remote.name}:${remote.path}`
				: "";

		if (!remoteTarget) {
			throw new Error("请在设置中填写 Remote 名称与远程路径。");
		}

		// rclone bisync 命令参数
		const args = [
			"bisync",
			vaultPath,
			remoteTarget,
			"--verbose",
			"--resync",
		];

		const startTime = Date.now();
		return new Promise((resolve, reject) => {
			const child = spawn(rclonePath, args, {
				shell: false,
			});

			let stderr = "";
			let stdout = "";

			child.stdout.on("data", (data) => {
				const text = data.toString();
				stdout += text;
				console.log(`[rclone stdout] ${text}`);
			});

			child.stderr.on("data", (data) => {
				const text = data.toString();
				stderr += text;
				console.warn(`[rclone stderr] ${text}`);
			});

			child.on("error", (error) => {
				reject(error);
			});

			child.on("close", (code) => {
				const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
				const combined = `${stdout}\n${stderr}`;

				/**
				 * 解析 rclone 输出：
				 *  - sizeLine: "Transferred: 1.234 MiB / 1.234 MiB, 100%, ..."
				 *    使用正则提取已传输大小和总大小
				 *  - countLine: "Transferred: 3 / 3, 100%"（某些配置会输出文件数）
				 *  - checksLine: "Checks: 10 / 10, 100%"
				 */
				const sizeLineMatch = combined.match(/Transferred:\s*([\d.]+\s*\w*i?B)\s*\/\s*([\d.]+\s*\w*i?B)/i);
				const countLineMatch = combined.match(/Transferred:\s*(\d+)\s*\/\s*(\d+)/i);
				const checksLineMatch = combined.match(/Checks:\s*(\d+)\s*\/\s*(\d+)/i);

				const transferredSize = sizeLineMatch ? sizeLineMatch[1] : undefined;
				const transferredFiles = countLineMatch ? parseInt(countLineMatch[1], 10) : undefined;
				const checksTotal = checksLineMatch ? parseInt(checksLineMatch[2], 10) : undefined;
				const checksDone = checksLineMatch ? parseInt(checksLineMatch[1], 10) : undefined;

				// 认定“无改动”条件：无文件传输且日志包含 up-to-date / No changes
				const noChanges =
					(transferredFiles !== undefined && transferredFiles === 0) ||
					/No changes|up.to.date|Nothing to do/i.test(combined);

				let summary = "";
				if (noChanges) {
					summary = `已是最新 (耗时 ${durationSec}s)`;
				} else if (transferredSize) {
					const filesPart = transferredFiles !== undefined ? `${transferredFiles} files` : "";
					const checksPart = checksLineMatch ? `, checks ${checksDone}/${checksTotal}` : "";
					summary = `${filesPart ? filesPart + ", " : ""}${transferredSize} (耗时 ${durationSec}s${checksPart})`;
				} else {
					summary = `完成 (耗时 ${durationSec}s)`;
				}

				if (code === 0) {
					resolve(summary);
				} else {
					reject(new Error(`rclone 退出码 ${code}\n${stderr || stdout}`));
				}
			});
		});
	}

	/** 加载设置 */
	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// 兼容旧版：如果旧字段存在且 remotes 为空，则迁移
		const legacyRemoteName = (data as any)?.remoteName;
		const legacyRemotePath = (data as any)?.remotePath;
		if ((!this.settings.remotes || this.settings.remotes.length === 0) && (legacyRemoteName || legacyRemotePath)) {
			this.settings.remotes = [
				{
					name: legacyRemoteName || "",
					path: legacyRemotePath || "",
					enable: true,
				},
			];
		}
	}

	/** 保存设置 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/** 设置页 */
class RcloneSettingTab extends PluginSettingTab {
	plugin: ObsidianRcloneBridgePlugin;

	constructor(app: App, plugin: ObsidianRcloneBridgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Obsidian Rclone Bridge 设置" });

		new Setting(containerEl)
			.setName("rclone 路径")
			.setDesc("请输入 rclone 可执行文件的绝对路径，例如 C:/rclone/rclone.exe 或 /usr/bin/rclone")
			.addText((text) =>
				text
					.setPlaceholder("/usr/bin/rclone")
					.setValue(this.plugin.settings.rclonePath)
					.onChange(async (value) => {
						this.plugin.settings.rclonePath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "多目的地设置" });
		const listEl = containerEl.createDiv({ cls: "rclone-remote-list" });

		const renderList = () => {
			listEl.empty();
			this.plugin.settings.remotes.forEach((remote, index) => {
				const setting = new Setting(listEl)
					.setName(remote.name || `Remote ${index + 1}`)
					.setDesc("配置 Remote 名称与路径，可单独启用/停用");

				setting.addText((text) =>
					text
						.setPlaceholder("onedrive")
						.setValue(remote.name)
						.onChange(async (value) => {
							remote.name = value.trim();
							await this.plugin.saveSettings();
							renderList();
						})
				);

				setting.addText((text) =>
					text
						.setPlaceholder("onedrive:my-vault 或 my-vault")
						.setValue(remote.path)
						.onChange(async (value) => {
							remote.path = value.trim();
							await this.plugin.saveSettings();
						})
				);

				setting.addToggle((toggle) =>
					toggle
						.setValue(remote.enable)
						.onChange(async (value) => {
							remote.enable = value;
							await this.plugin.saveSettings();
						})
				).setDesc("启用");

				setting.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("删除该 Remote")
						.onClick(async () => {
							this.plugin.settings.remotes.splice(index, 1);
							await this.plugin.saveSettings();
							renderList();
						})
				);
			});
		};

		renderList();

		new Setting(containerEl)
			.setName("添加 Remote")
			.setDesc("新增一个同步目的地")
			.addButton((button) =>
				button
					.setButtonText("添加")
					.setCta()
					.onClick(async () => {
						this.plugin.settings.remotes.push({ name: "", path: "", enable: true });
						await this.plugin.saveSettings();
						renderList();
					})
			);
	}
}
