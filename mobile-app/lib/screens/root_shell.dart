import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:provider/provider.dart';

import '../providers/region_provider.dart';
import '../theme/app_theme.dart';
import 'alerts_screen.dart';
import 'home_screen.dart';
import 'reports_screen.dart';
import 'risk_map_screen.dart';

/// 4-tab bottom nav — Home / Alert / Maps / Reports — matching the Figma
/// design's floating pill nav bar exactly. Settings isn't a bottom tab in
/// the design; it's reached from Home's app bar instead (see `HomeScreen`).
class RootShell extends StatefulWidget {
  const RootShell({super.key});

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> with WidgetsBindingObserver {
  int _index = 0;

  static const _screens = [
    HomeScreen(),
    AlertsScreen(),
    RiskMapScreen(),
    ReportsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Refreshes region/alert data whenever the app comes back to the
  /// foreground — e.g. after the user taps a push notification, or just
  /// switches back to a backgrounded tab. Without this, a push arriving
  /// while the app was backgrounded never shows up on Home until the user
  /// manually navigates away and back (there's no live polling).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      context.read<RegionProvider>().load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final items = [
      (icon: Icons.home_outlined, selectedIcon: Icons.home, label: l10n.navHome),
      (icon: Icons.notifications_none, selectedIcon: Icons.notifications, label: l10n.navAlert),
      (icon: Icons.map_outlined, selectedIcon: Icons.map, label: l10n.navMaps),
      (icon: Icons.bar_chart_outlined, selectedIcon: Icons.bar_chart, label: l10n.navReports),
    ];
    return Scaffold(
      body: Stack(
        children: [
          IndexedStack(index: _index, children: _screens),
          Positioned(
            left: 16,
            right: 16,
            bottom: 16,
            child: _PillNavBar(
              index: _index,
              items: items,
              onChanged: (i) => setState(() => _index = i),
            ),
          ),
        ],
      ),
      // Extra room at the bottom of each screen's content so the floating
      // nav bar never covers the last item — screens already scroll, this
      // just keeps their content clear of the overlay.
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
    );
  }
}

class _PillNavBar extends StatelessWidget {
  final int index;
  final List<({IconData icon, IconData selectedIcon, String label})> items;
  final ValueChanged<int> onChanged;

  const _PillNavBar({required this.index, required this.items, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 16, offset: const Offset(0, 6)),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++)
            Expanded(
              child: _PillNavItem(
                icon: items[i].icon,
                selectedIcon: items[i].selectedIcon,
                label: items[i].label,
                selected: i == index,
                onTap: () => onChanged(i),
              ),
            ),
        ],
      ),
    );
  }
}

class _PillNavItem extends StatelessWidget {
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _PillNavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.navy : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(selected ? selectedIcon : icon, color: selected ? Colors.white : AppColors.inkSoft, size: 22),
            const SizedBox(height: 2),
            // FittedBox instead of a fixed font size: translated labels
            // (e.g. French, Portuguese) run longer than the English
            // originals and would otherwise overflow this fixed-width pill.
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                label,
                maxLines: 1,
                style: TextStyle(
                  color: selected ? Colors.white : AppColors.inkSoft,
                  fontSize: 11,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
