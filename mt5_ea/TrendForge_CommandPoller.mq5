//+------------------------------------------------------------------+
//|                                    TrendForge_CommandPoller.mq5   |
//|                                  Copyright 2026, TrendForge AI   |
//|                                       https://ai.studio/build    |
//+------------------------------------------------------------------+
#property copyright "TrendForge AI"
#property link      "https://ai.studio/build"
#property version   "1.00"
#property description "Inverted MT5 Bridge EA: Polls TrendForge cloud for commands and posts terminal state."

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- input parameters
input string   InpServerUrl      = "http://localhost:3000"; // TrendForge Server URL (No trailing slash)
input int      InpPollIntervalMs = 1000;                    // Command polling interval (milliseconds)
input int      InpStateIntervalS = 5;                       // State sync interval (seconds)

//--- global variables
CTrade         m_trade;
CPositionInfo  m_position;
long           m_login;
datetime       m_lastStateSync = 0;
int            m_pollTimerId = 1;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   m_login = AccountInfoInteger(ACCOUNT_LOGIN);
   PrintFormat("[TrendForge] Initializing Command Poller EA for Account: %d", m_login);
   PrintFormat("[TrendForge] Server URL: %s", InpServerUrl);
   
   // Create timer for polling
   EventSetMillisecondTimer(InpPollIntervalMs);
   
   // Immediate first state sync
   SyncAccountState();
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[TrendForge] Command Poller EA stopped.");
}

//+------------------------------------------------------------------+
//| Expert timer function                                            |
//+------------------------------------------------------------------+
void OnTimer()
{
   // 1. Poll for pending trading commands
   PollCommands();
   
   // 2. Periodically push active positions and account balance
   datetime now = TimeCurrent();
   if(now - m_lastStateSync >= InpStateIntervalS)
   {
      SyncAccountState();
      m_lastStateSync = now;
   }
}

//+------------------------------------------------------------------+
//| Poll pending commands from the cloud server                      |
//+------------------------------------------------------------------+
void PollCommands()
{
   string url = InpServerUrl + "/api/mt5/commands?login=" + IntegerToString(m_login);
   string headers = "Accept: application/json\r\n";
   char post[], result[];
   string resultHeaders;
   
   int res = WebRequest("GET", url, headers, 3000, post, result, resultHeaders);
   if(res == -1)
   {
      int errorCode = GetLastError();
      if(errorCode == 4014)
      {
         // URL not allowed in Terminal options
         static bool warningShown = false;
         if(!warningShown)
         {
            PrintFormat("[TrendForge ERROR] WebRequest not allowed! Add URL '%s' to Tools -> Options -> Expert Advisors -> Allow WebRequest", InpServerUrl);
            warningShown = true;
         }
      }
      return;
   }
   
   if(res == 200)
   {
      string jsonResponse = CharArrayToString(result);
      if(jsonResponse != "[]" && StringLen(jsonResponse) > 5)
      {
         PrintFormat("[TrendForge] Received commands: %s", jsonResponse);
         ProcessCommandsJson(jsonResponse);
      }
   }
}

//+------------------------------------------------------------------+
//| Parse and process multiple commands in a JSON array              |
//+------------------------------------------------------------------+
void ProcessCommandsJson(string json)
{
   // Simple JSON array parser for MT5 commands
   int pos = 0;
   while((pos = StringFind(json, "{\"", pos)) != -1)
   {
      int endPos = StringFind(json, "}", pos);
      if(endPos == -1) break;
      
      string cmdJson = StringSubstr(json, pos, endPos - pos + 1);
      ProcessSingleCommand(cmdJson);
      
      pos = endPos + 1;
   }
}

//+------------------------------------------------------------------+
//| Processes a single JSON command string and sends trade orders    |
//+------------------------------------------------------------------+
void ProcessSingleCommand(string cmdJson)
{
   string cmdId  = ExtractJsonValue(cmdJson, "id");
   string action = ExtractJsonValue(cmdJson, "action");
   string symbol = ExtractJsonValue(cmdJson, "symbol");
   double volume = StringToDouble(ExtractJsonValue(cmdJson, "volume"));
   string ticket = ExtractJsonValue(cmdJson, "ticket");
   double sl     = StringToDouble(ExtractJsonValue(cmdJson, "sl"));
   double tp     = StringToDouble(ExtractJsonValue(cmdJson, "tp"));
   double price  = StringToDouble(ExtractJsonValue(cmdJson, "price"));
   
   PrintFormat("[TrendForge] Executing command %s: %s %s %.2f lots", cmdId, action, symbol, volume);
   
   bool success = false;
   string errorMsg = "";
   ulong tradeTicket = 0;
   
   if(action == "BUY")
   {
      success = m_trade.Buy(volume, symbol, 0, sl, tp, "TrendForge Buy");
      if(!success) errorMsg = m_trade.ResultComment();
      else tradeTicket = m_trade.ResultDeal();
   }
   else if(action == "SELL")
   {
      success = m_trade.Sell(volume, symbol, 0, sl, tp, "TrendForge Sell");
      if(!success) errorMsg = m_trade.ResultComment();
      else tradeTicket = m_trade.ResultDeal();
   }
   else if(action == "CLOSE")
   {
      ulong tkt = StringToInteger(ticket);
      success = m_trade.PositionClose(tkt);
      if(!success) errorMsg = m_trade.ResultComment();
   }
   else if(action == "MODIFY")
   {
      ulong tkt = StringToInteger(ticket);
      success = m_trade.PositionModify(tkt, sl, tp);
      if(!success) errorMsg = m_trade.ResultComment();
   }
   else
   {
      errorMsg = "Unknown action: " + action;
   }
   
   // Post results back
   PostCommandResult(cmdId, success, tradeTicket, errorMsg);
}

//+------------------------------------------------------------------+
//| Post command execution result back to the server                 |
//+------------------------------------------------------------------+
void PostCommandResult(string cmdId, bool success, ulong ticket, string errorMsg)
{
   string url = InpServerUrl + "/api/mt5/results";
   string headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
   
   string status = success ? "success" : "failed";
   string body = StringFormat("{\"commandId\":\"%s\",\"status\":\"%s\",\"ticket\":\"%s\",\"error\":\"%s\"}",
                              cmdId, status, IntegerToString(ticket), errorMsg);
                              
   char post[], result[];
   string resultHeaders;
   StringToCharArray(body, post);
   
   int res = WebRequest("POST", url, headers, 3000, post, result, resultHeaders);
   if(res != 200)
   {
      PrintFormat("[TrendForge ERROR] Failed to send execution result for %s. Server response code: %d", cmdId, res);
   }
}

//+------------------------------------------------------------------+
//| Sync active terminal state (balance, equity, positions) with cloud|
//+------------------------------------------------------------------+
void SyncAccountState()
{
   string url = InpServerUrl + "/api/mt5/state";
   string headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
   
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   
   // Build positions JSON list
   string positionsJson = "[";
   int total = PositionsTotal();
   int count = 0;
   
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0)
      {
         if(count > 0) positionsJson += ",";
         
         string posSymbol = PositionGetString(POSITION_SYMBOL);
         long posType = PositionGetInteger(POSITION_TYPE);
         string side = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
         double volume = PositionGetDouble(POSITION_VOLUME);
         double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
         double sl = PositionGetDouble(POSITION_SL);
         double tp = PositionGetDouble(POSITION_TP);
         double pnl = PositionGetDouble(POSITION_PROFIT);
         
         positionsJson += StringFormat("{\"ticket\":\"%s\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.2f,\"openPrice\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"pnl\":%.2f}",
                                       IntegerToString(ticket), posSymbol, side, volume, openPrice, sl, tp, pnl);
         count++;
      }
   }
   positionsJson += "]";
   
   string body = StringFormat("{\"login\":\"%d\",\"balance\":%.2f,\"equity\":%.2f,\"currency\":\"%s\",\"positions\":%s}",
                              m_login, balance, equity, currency, positionsJson);
                              
   char post[], result[];
   string resultHeaders;
   StringToCharArray(body, post);
   
   int res = WebRequest("POST", url, headers, 3000, post, result, resultHeaders);
   if(res != 200)
   {
      PrintFormat("[TrendForge ERROR] Failed to sync account state. HTTP Status: %d", res);
   }
}

//+------------------------------------------------------------------+
//| Simple JSON field value extractor                                |
//+------------------------------------------------------------------+
string ExtractJsonValue(string json, string key)
{
   string keySearch = "\"" + key + "\":";
   int startIdx = StringFind(json, keySearch);
   if(startIdx == -1) return "";
   
   int valStart = startIdx + StringLen(keySearch);
   
   // Skip spaces
   while(valStart < StringLen(json) && (StringGetCharacter(json, valStart) == ' ' || StringGetCharacter(json, valStart) == '\t'))
   {
      valStart++;
   }
   
   ushort firstChar = StringGetCharacter(json, valStart);
   if(firstChar == '"')
   {
      // String value
      valStart++;
      int valEnd = StringFind(json, "\"", valStart);
      if(valEnd == -1) return "";
      return StringSubstr(json, valStart, valEnd - valStart);
   }
   else
   {
      // Numeric or boolean value
      int valEnd = valStart;
      while(valEnd < StringLen(json))
      {
         ushort c = StringGetCharacter(json, valEnd);
         if(c == ',' || c == '}' || c == ']' || c == '\n' || c == '\r') break;
         valEnd++;
      }
      return StringSubstr(json, valStart, valEnd - valStart);
   }
}
