import * as vscode from 'vscode';
import { DiffSoundsConfig, AttributionMode } from './types';

export class AttributionService {
  private liveShareApi: any = null;

  constructor() {
    this.initializeLiveShare();
  }

  private async initializeLiveShare() {
    const liveShareExtension = vscode.extensions.getExtension('ms-vsliveshare.vsliveshare');
    if (liveShareExtension && !liveShareExtension.isActive) {
      await liveShareExtension.activate();
    }
    if (liveShareExtension?.exports?.getApi) {
      try {
        this.liveShareApi = await liveShareExtension.exports.getApi('1.0.0');
      } catch (error) {
        console.warn('Live Share API not available:', error);
      }
    }
  }

  async shouldPlaySound(config: DiffSoundsConfig, documentUri?: vscode.Uri): Promise<boolean> {
    if (!config.enabled) return false;

    switch (config.attributionMode) {
      case 'any':
        return true;
      case 'live-only':
        return await this.checkLiveAttribution(config.authorName);
      case 'git-only':
        return await this.checkGitAttribution(config.authorName, documentUri);
      default:
        return false;
    }
  }

  private async checkLiveAttribution(authorName: string): Promise<boolean> {
    if (!this.liveShareApi) return false;

    try {
      const session = this.liveShareApi.session;
      if (!session) return false;

      const participants = Array.from(session.participants.values());
      // Assume the local user is the active editor, but for diff, need to check who made the edit.

      // For MVP, check if any participant name matches, or the local user.
      // Live Share has edit sessions, it's complex.
      // For simplicity, check if the session has a participant with name authorName.
      const hasParticipant = participants.some((p: any) => p.userInfo?.displayName === authorName || p.userInfo?.userName === authorName);
      return hasParticipant;
    } catch (error) {
      console.warn('Error checking Live Share attribution:', error);
      return false;
    }
  }

  private async checkGitAttribution(authorName: string, documentUri?: vscode.Uri): Promise<boolean> {
    if (!documentUri) return false;

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension || !gitExtension.isActive) return false;

    try {
      const gitApi = gitExtension.exports.getAPI(1);
      const repo = gitApi.repositories.find((r: any) => r.rootUri.path === vscode.workspace.getWorkspaceFolder(documentUri)?.uri.path);
      if (!repo) return false;

      // For simple MVP, check the last commit author on this file.
      // But for diff, it's the commit being viewed.
      // If there's a HEAD vs working tree, then perhaps check if author is Cline.
      // But hard to attribute per edit.

      // For MVP, return false if not implemented.
      return false;
    } catch (error) {
      console.warn('Error checking git attribution:', error);
      return false;
    }
  }
}
