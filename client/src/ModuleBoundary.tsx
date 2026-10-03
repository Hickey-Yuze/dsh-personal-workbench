/**
 * 模块级错误边界：单个模块渲染崩溃时只降级该模块并显示错误文本，
 * 不再拖死整个面板（白屏不可诊断）。错误信息同时落 console 便于定位。
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode; label?: string }
interface State { err: Error | null }

export class ModuleBoundary extends Component<Props, State> {
  override state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error(`[pwb] 模块崩溃${this.props.label !== undefined ? `（${this.props.label}）` : ''}:`, err, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.err !== null) {
      return (
        <div style={{ padding: 24, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#b42318', background: 'rgba(229,72,77,0.06)', borderRadius: 12, border: '1px solid rgba(229,72,77,0.25)', whiteSpace: 'pre-wrap', overflow: 'auto' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>⚠︎ {this.props.label ?? '模块'}渲染崩溃（不影响其他模块）</div>
          <div>{this.state.err.message}</div>
          <div style={{ marginTop: 8, opacity: 0.75, fontSize: 11 }}>{this.state.err.stack?.split('\n').slice(1, 5).join('\n')}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
