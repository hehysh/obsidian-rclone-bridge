import { App, Notice, Plugin, PluginSettingTab, Setting, StatusBarItem } from "obsidian";
import { spawn } from "child_process";

/**
 * 插件设置接口
 */
interface ObsidianRcloneBridgeSettings {
	/** rclone 可执行文件的绝对路径 */
	rclonePath: string;
	/** rclone 配置中的 Remote 名称 */
	remoteName: string;
	/** 远程路径（可包含 remote 名称，如 onedrive:my-vault） */
	remotePath: string;
}

const DEFAULT_SETTINGS: ObsidianRcloneBridgeSettings = {
	rclonePath: "",
	remoteName: "",
	remotePath: "",
};

/** 状态栏展示文本 */
type SyncStatus = "就绪" | "正在同步..." | "同步成功" | "同步失败";

export default class ObsidianRcloneBridgePlugin extends Plugin {
	settings: ObsidianRcloneBridgeSettings;
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

	/** 统一处理同步流程与状态/提示 */
	private async handleSync() {
		if (this.isSyncing) {
			new Notice("已有同步任务正在进行，请稍候...");
			return;
		}

		this.isSyncing = true;
		this.updateStatus("正在同步...");

		try {
			await this.runRcloneSync();
			this.updateStatus("同步成功");
			new Notice("同步成功 ✅");
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
	 * 调用 rclone bisync 进行双向同步
	 */
	async runRcloneSync(): Promise<void> {
		const { rclonePath, remoteName, remotePath } = this.settings;

		if (!rclonePath) {
			throw new Error("请在设置中填写 rclone 可执行文件的绝对路径。");
		}

		const vaultPath = (this.app.vault.adapter as any).getBasePath?.();
		if (!vaultPath) {
			throw new Error("无法获取当前 Vault 的本地路径（仅桌面端支持）。");
		}

		// 允许用户直接写完整 remotePath（含冒号），否则拼接 remoteName
		const remoteTarget = remotePath.includes(":")
			? remotePath
			: remoteName
				? `${remoteName}:${remotePath}`
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

		return new Promise((resolve, reject) => {
			const child = spawn(rclonePath, args, {
				shell: false,
			});

			let stderr = "";

			child.stdout.on("data", (data) => {
				console.log(`[rclone stdout] ${data}`);
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
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`rclone 退出码 ${code}\n${stderr}`));
				}
			});
		});
	}

	/** 加载设置 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

		new Setting(containerEl)
			.setName("Remote 名称")
			.setDesc("对应 rclone config 中的 remote 名称，例如 onedrive")
			.addText((text) =>
				text
					.setPlaceholder("onedrive")
					.setValue(this.plugin.settings.remoteName)
					.onChange(async (value) => {
						this.plugin.settings.remoteName = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("远程路径")
			.setDesc("例如 onedrive:my-vault，或仅填写 my-vault（会自动拼接 remote 名称）")
			.addText((text) =>
				text
					.setPlaceholder("onedrive:my-vault")
					.setValue(this.plugin.settings.remotePath)
					.onChange(async (value) => {
						this.plugin.settings.remotePath = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}
}
