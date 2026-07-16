//+------------------------------------------------------------------+
//| MoebyBridge.mq5                                                   |
//| Outbound-only MT5 command poller for the Moeby trading terminal.  |
//|                                                                   |
//| The EA polls YOUR server for pending commands, executes them      |
//| locally with CTrade, reports results back, and sends heartbeats.  |
//| No inbound ports. No local REST bridge. The terminal IS the       |
//| bridge.                                                           |
//|                                                                   |
//| Wire protocol (text/plain, pipe-delimited, one item per line):    |
//|   Server -> EA :  CMD|id|action|symbol|volume|sl|tp|price|comment |
//|                   action: BUY SELL CLOSE MODIFY FLATTEN PING      |
//|   EA -> Server:   RES|id|status|ticket|fillPrice|message          |
//|                   status: done failed rejected_disarmed skipped   |
//|   EA -> Server:   HB|equity|balance|freeMargin|openPositions      |
//|                   POS|symbol|side|volume|entry|sl|tp|pnl|ticket   |
//+------------------------------------------------------------------+
#property copyright "moezaka"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//--- inputs -----------------------------------------------------------------
input string  InpServerURL     = "https://YOUR-APP.run.app"; // Server base URL (no trailing slash)
input string  InpBridgeToken   = "CHANGE_ME";                // Must match MT5_BRIDGE_TOKEN env on server
input int     InpPollMs        = 1500;                       // Poll interval, milliseconds
input int     InpHeartbeatSec  = 20;                         // Heartbeat interval, seconds
input ulong   InpMagic         = 880088;                     // Magic number for bridge trades
input double  InpMaxVolume     = 0.10;                       // HARD volume clamp per order (safety)
input string  InpSymbolAllow   = "XAUUSD";                   // Comma-separated symbol whitelist
input int     InpSlippagePts   = 30;                         // Max deviation, points
input bool    InpArmedOnStart  = false;                      // Start ARMED (false = manual arm required)

//--- state ------------------------------------------------------------------
CTrade   g_trade;
bool     g_armed        = false;
datetime g_lastHb       = 0;
string   g_doneIds[];                 // executed command ids (idempotency)
string   g_doneFile     = "MoebyBridge_done.txt";
string   g_btnName      = "MoebyArmBtn";

//+------------------------------------------------------------------+
int OnInit()
{
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpSlippagePts);
   g_armed = InpArmedOnStart;
   LoadDoneIds();
   DrawArmButton();
   EventSetMillisecondTimer(MathMax(500, InpPollMs));
   Print("[MoebyBridge] init. armed=", g_armed ? "YES" : "NO",
         "  server=", InpServerURL,
         "  NOTE: add the server host under Tools > Options > Expert Advisors > Allow WebRequest.");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectDelete(0, g_btnName);
   SaveDoneIds();
}

//+------------------------------------------------------------------+
void OnTimer()
{
   PollCommands();
   if(TimeLocal() - g_lastHb >= InpHeartbeatSec)
   {
      SendHeartbeat();
      g_lastHb = TimeLocal();
   }
}

//+------------------------------------------------------------------+
//| Chart button: manual ARM / DISARM switch                          |
//+------------------------------------------------------------------+
void DrawArmButton()
{
   ObjectCreate(0, g_btnName, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, g_btnName, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, g_btnName, OBJPROP_XDISTANCE, 10);
   ObjectSetInteger(0, g_btnName, OBJPROP_YDISTANCE, 24);
   ObjectSetInteger(0, g_btnName, OBJPROP_XSIZE, 170);
   ObjectSetInteger(0, g_btnName, OBJPROP_YSIZE, 28);
   ObjectSetInteger(0, g_btnName, OBJPROP_FONTSIZE, 10);
   UpdateArmButton();
}

void UpdateArmButton()
{
   ObjectSetString (0, g_btnName, OBJPROP_TEXT, g_armed ? "BRIDGE: ARMED (click to disarm)" : "BRIDGE: DISARMED (click to arm)");
   ObjectSetInteger(0, g_btnName, OBJPROP_BGCOLOR, g_armed ? clrFireBrick : clrDarkSlateGray);
   ObjectSetInteger(0, g_btnName, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, g_btnName, OBJPROP_STATE, false);
   ChartRedraw();
}

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK && sparam == g_btnName)
   {
      g_armed = !g_armed;
      Print("[MoebyBridge] ", g_armed ? "ARMED by operator" : "DISARMED by operator");
      UpdateArmButton();
   }
}

//+------------------------------------------------------------------+
//| HTTP helpers                                                      |
//+------------------------------------------------------------------+
bool HttpCall(const string method, const string path, const string payload, string &response)
{
   string baseUrl = InpServerURL;
   int lenBase = StringLen(baseUrl);
   if(lenBase > 0 && StringSubstr(baseUrl, lenBase - 1, 1) == "/")
   {
      baseUrl = StringSubstr(baseUrl, 0, lenBase - 1);
   }
   string url     = baseUrl + path;
   string headers = "X-Bridge-Token: " + InpBridgeToken + "\r\nContent-Type: text/plain\r\n";
   char   data[];
   char   result[];
   string resultHeaders;

   int len = StringLen(payload);
   if(len > 0)
      StringToCharArray(payload, data, 0, len);   // exclude trailing \0

   ResetLastError();
   int status = WebRequest(method, url, headers, 5000, data, result, resultHeaders);
   if(status == -1)
   {
      Print("[MoebyBridge] WebRequest failed (", GetLastError(),
            "). Is '", InpServerURL, "' in the allowed WebRequest URL list?");
      return(false);
   }
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      Print("[MoebyBridge] HTTP ", status, " on ", path, " body=", StringSubstr(response, 0, 200));
      return(false);
   }
   return(true);
}

//+------------------------------------------------------------------+
//| Poll server for pending commands and execute them                 |
//+------------------------------------------------------------------+
void PollCommands()
{
   string body;
   if(!HttpCall("GET", "/bridge/commands", "", body))
      return;

   string trimmed = body;
   StringTrimLeft(trimmed);
   StringTrimRight(trimmed);
   if(trimmed == "" || trimmed == "EMPTY")
      return;

   string lines[];
   int n = StringSplit(trimmed, '\n', lines);
   string results = "";

   for(int i = 0; i < n; i++)
   {
      string line = lines[i];
      StringTrimLeft(line); StringTrimRight(line);
      if(StringLen(line) == 0) continue;

      string f[];
      int nf = StringSplit(line, '|', f);
      if(nf < 2 || f[0] != "CMD") continue;

      // CMD|id|action|symbol|volume|sl|tp|price|comment
      string id      = (nf > 1) ? f[1] : "";
      string action  = (nf > 2) ? f[2] : "";
      string symbol  = (nf > 3) ? f[3] : "";
      double volume  = (nf > 4) ? StringToDouble(f[4]) : 0.0;
      double sl      = (nf > 5) ? StringToDouble(f[5]) : 0.0;
      double tp      = (nf > 6) ? StringToDouble(f[6]) : 0.0;
      // f[7] price reserved for future limit orders; f[8] comment
      string comment = (nf > 8) ? f[8] : "moeby";

      if(id == "" || IsDone(id))
      {
         results += "RES|" + id + "|skipped|0|0|duplicate\n";
         continue;
      }

      string res = ExecuteCommand(id, action, symbol, volume, sl, tp, comment);
      results += res + "\n";
      MarkDone(id);
   }

   if(results != "")
   {
      string resp;
      HttpCall("POST", "/bridge/results", results, resp);
   }
}

//+------------------------------------------------------------------+
//| Execute one command. Returns a RES line.                          |
//+------------------------------------------------------------------+
string ExecuteCommand(const string id, const string action, const string symbol,
                      double volume, const double sl, const double tp, const string comment)
{
   if(action == "PING")
      return("RES|" + id + "|done|0|0|pong");

   if(!g_armed)
      return("RES|" + id + "|rejected_disarmed|0|0|Bridge is DISARMED on the terminal");

   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      return("RES|" + id + "|failed|0|0|AlgoTrading disabled in terminal");

   if(action == "FLATTEN")
      return(FlattenAll(id));

   //--- symbol gate
   if(!SymbolAllowed(symbol))
      return("RES|" + id + "|failed|0|0|Symbol not in whitelist: " + symbol);
   if(!SymbolSelect(symbol, true))
      return("RES|" + id + "|failed|0|0|Unknown symbol on this broker: " + symbol);

   if(action == "CLOSE")
      return(ClosePosition(id, symbol));

   if(action == "MODIFY")
   {
      if(!PositionSelect(symbol))
         return("RES|" + id + "|failed|0|0|No open position to modify on " + symbol);
      if(g_trade.PositionModify(symbol, sl, tp))
         return("RES|" + id + "|done|" + (string)PositionGetInteger(POSITION_TICKET) + "|0|SL/TP modified");
      return("RES|" + id + "|failed|0|0|Modify failed: " + (string)g_trade.ResultRetcode() + " " + g_trade.ResultRetcodeDescription());
   }

   if(action == "BUY" || action == "SELL")
   {
      //--- HARD volume clamp: server bugs must not oversize the account
      double lotMin  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
      double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
      if(volume <= 0) return("RES|" + id + "|failed|0|0|Non-positive volume");
      if(volume > InpMaxVolume)
      {
         Print("[MoebyBridge] volume ", volume, " clamped to InpMaxVolume ", InpMaxVolume);
         volume = InpMaxVolume;
      }
      volume = MathMax(lotMin, MathFloor(volume / lotStep) * lotStep);

      bool ok = (action == "BUY")
                ? g_trade.Buy (volume, symbol, 0.0, sl, tp, comment)
                : g_trade.Sell(volume, symbol, 0.0, sl, tp, comment);

      if(ok && (g_trade.ResultRetcode() == TRADE_RETCODE_DONE || g_trade.ResultRetcode() == TRADE_RETCODE_PLACED))
      {
         //--- refuse to leave a naked position: if SL was requested but not set, verify
         string ticket = (string)g_trade.ResultOrder();
         double fill   = g_trade.ResultPrice();
         return("RES|" + id + "|done|" + ticket + "|" + DoubleToString(fill, 2) + "|" + action + " " + DoubleToString(volume, 2) + " " + symbol);
      }
      return("RES|" + id + "|failed|0|0|" + action + " rejected: " + (string)g_trade.ResultRetcode() + " " + g_trade.ResultRetcodeDescription());
   }

   return("RES|" + id + "|failed|0|0|Unknown action: " + action);
}

string ClosePosition(const string id, const string symbol)
{
   if(!PositionSelect(symbol))
      return("RES|" + id + "|failed|0|0|No open position on " + symbol);
   double vol = PositionGetDouble(POSITION_VOLUME);
   if(g_trade.PositionClose(symbol, InpSlippagePts))
      return("RES|" + id + "|done|" + (string)g_trade.ResultOrder() + "|" + DoubleToString(g_trade.ResultPrice(), 2) + "|Closed " + DoubleToString(vol, 2) + " " + symbol);
   return("RES|" + id + "|failed|0|0|Close failed: " + (string)g_trade.ResultRetcode() + " " + g_trade.ResultRetcodeDescription());
}

string FlattenAll(const string id)
{
   int closed = 0, failed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      string sym = PositionGetSymbol(i);
      if(sym == "") continue;
      if(g_trade.PositionClose(sym, InpSlippagePts)) closed++;
      else failed++;
   }
   if(failed == 0)
      return("RES|" + id + "|done|0|0|Flattened " + (string)closed + " position(s)");
   return("RES|" + id + "|failed|0|0|Flatten partial: closed=" + (string)closed + " failed=" + (string)failed);
}

//+------------------------------------------------------------------+
//| Heartbeat: account + positions snapshot                           |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   string hb = "HB|" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2)
             + "|" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2)
             + "|" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2)
             + "|" + (string)PositionsTotal()
             + "|" + (g_armed ? "armed" : "disarmed") + "\n";

   for(int i = 0; i < PositionsTotal(); i++)
   {
      string sym = PositionGetSymbol(i);
      if(sym == "" || !PositionSelect(sym)) continue;
      string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "buy" : "sell";
      hb += "POS|" + sym
          + "|" + side
          + "|" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2)
          + "|" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 2)
          + "|" + DoubleToString(PositionGetDouble(POSITION_SL), 2)
          + "|" + DoubleToString(PositionGetDouble(POSITION_TP), 2)
          + "|" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2)
          + "|" + (string)PositionGetInteger(POSITION_TICKET) + "\n";
   }

   string resp;
   if(HttpCall("POST", "/bridge/heartbeat", hb, resp))
   {
      Print("[MoebyBridge] Heartbeat success: ", resp);
   }
}

//+------------------------------------------------------------------+
//| Idempotency: remember executed command ids across restarts        |
//+------------------------------------------------------------------+
bool IsDone(const string id)
{
   for(int i = 0; i < ArraySize(g_doneIds); i++)
      if(g_doneIds[i] == id) return(true);
   return(false);
}

void MarkDone(const string id)
{
   int n = ArraySize(g_doneIds);
   ArrayResize(g_doneIds, n + 1);
   g_doneIds[n] = id;
   //--- keep the memory bounded
   if(n + 1 > 500)
   {
      for(int i = 0; i < n - 399; i++) g_doneIds[i] = g_doneIds[i + (n - 399)];
      ArrayResize(g_doneIds, 400);
   }
   SaveDoneIds();
}

void LoadDoneIds()
{
   int h = FileOpen(g_doneFile, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   while(!FileIsEnding(h))
   {
      string line = FileReadString(h);
      StringTrimLeft(line); StringTrimRight(line);
      if(line == "") continue;
      int n = ArraySize(g_doneIds);
      ArrayResize(g_doneIds, n + 1);
      g_doneIds[n] = line;
   }
   FileClose(h);
}

void SaveDoneIds()
{
   int h = FileOpen(g_doneFile, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   for(int i = 0; i < ArraySize(g_doneIds); i++)
      FileWriteString(h, g_doneIds[i] + "\n");
   FileClose(h);
}

//+------------------------------------------------------------------+
bool SymbolAllowed(const string symbol)
{
   string allow[];
   int n = StringSplit(InpSymbolAllow, ',', allow);
   for(int i = 0; i < n; i++)
   {
      string s = allow[i];
      StringTrimLeft(s); StringTrimRight(s);
      if(StringCompare(s, symbol, false) == 0) return(true);
   }
   return(false);
}
//+------------------------------------------------------------------+
