import { inject, injectable } from 'inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MenuModelRegistry, MenuNode } from '@theia/core/lib/common/menu';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { BoardsServiceClientImpl } from './boards-service-client-impl';
import { Board, ConfigOption } from '../../common/protocol';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { BoardsConfigStore } from './boards-config-store';
import { MainMenuManager } from '../../common/main-menu-manager';
import { ArduinoMenus } from '../menu/arduino-menus';

@injectable()
export class BoardsDetailsMenuUpdater implements FrontendApplicationContribution {

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(MenuModelRegistry)
    protected readonly menuRegistry: MenuModelRegistry;

    @inject(MainMenuManager)
    protected readonly mainMenuManager: MainMenuManager;

    @inject(BoardsConfigStore)
    protected readonly boardsConfigStore: BoardsConfigStore;

    @inject(BoardsServiceClientImpl)
    protected readonly boardsServiceClient: BoardsServiceClientImpl;

    protected readonly toDisposeOnBoardChange = new DisposableCollection();

    onStart(): void {
        this.boardsConfigStore.onChanged(() => this.updateMenuActions(this.boardsServiceClient.boardsConfig.selectedBoard));
        this.boardsServiceClient.onBoardsConfigChanged(({ selectedBoard }) => this.updateMenuActions(selectedBoard));
        this.updateMenuActions(this.boardsServiceClient.boardsConfig.selectedBoard);
    }

    protected async updateMenuActions(selectedBoard: Board | undefined): Promise<void> {
        if (selectedBoard) {
            this.toDisposeOnBoardChange.dispose();
            this.mainMenuManager.update();
            const { fqbn } = selectedBoard;
            if (fqbn) {
                const configOptions = await this.boardsConfigStore.getConfig(fqbn);
                const boardsConfigMenuPath = [...ArduinoMenus.TOOLS, 'z_boardsConfig']; // `z_` is for ordering.
                for (const { label, option, values } of configOptions.sort(ConfigOption.LABEL_COMPARATOR)) {
                    const menuPath = [...boardsConfigMenuPath, `${option}`];
                    const commands = new Map<string, Disposable & { label: string }>()
                    for (const value of values) {
                        const id = `${fqbn}-${option}--${value.value}`;
                        const command = { id };
                        const selectedValue = value.value;
                        const handler = {
                            execute: () => this.boardsConfigStore.setSelected({ fqbn, option, selectedValue }),
                            isToggled: () => value.selected
                        };
                        commands.set(id, Object.assign(this.commandRegistry.registerCommand(command, handler), { label: value.label }));
                    }
                    this.menuRegistry.registerSubmenu(menuPath, label);
                    this.toDisposeOnBoardChange.pushAll([
                        ...commands.values(),
                        Disposable.create(() => this.unregisterSubmenu(menuPath)), // We cannot dispose submenu entries: https://github.com/eclipse-theia/theia/issues/7299
                        ...Array.from(commands.keys()).map((commandId, index) => {
                            const { label } = commands.get(commandId)!;
                            this.menuRegistry.registerMenuAction(menuPath, { commandId, order: String(index), label });
                            return Disposable.create(() => this.menuRegistry.unregisterMenuAction(commandId));
                        })
                    ]);
                }
                this.mainMenuManager.update();
            }
        }
    }

    protected unregisterSubmenu(menuPath: string[]): void {
        if (menuPath.length < 2) {
            throw new Error(`Expected at least two item as a menu-path. Got ${JSON.stringify(menuPath)} instead.`);
        }
        const toRemove = menuPath[menuPath.length - 1];
        const parentMenuPath = menuPath.slice(0, menuPath.length - 1);
        // This is unsafe. Calling `getMenu` with a non-existing menu-path will result in a new menu creation.
        // https://github.com/eclipse-theia/theia/issues/7300
        const parent = this.menuRegistry.getMenu(parentMenuPath);
        const index = parent.children.findIndex(({ id }) => id === toRemove);
        if (index === -1) {
            throw new Error(`Could not find menu with menu-path: ${JSON.stringify(menuPath)}.`);
        }
        (parent.children as Array<MenuNode>).splice(index, 1);
    }

}
