//+------------------------------------------------------------------+
//| ExportBars.mq5 — dump broker history to CSV for the backtester.  |
//|                                                                  |
//| Bybit's XAUUSDT perp only has ~5 months of history, which is far  |
//| too short to validate an intraday strategy across regimes. Your   |
//| MT5 broker has years. This exports it in the format the           |
//| CsvDataProvider reads.                                            |
//|                                                                  |
//| USAGE                                                             |
//|  1. Copy to  MQL5/Scripts/  in your MT5 data folder               |
//|     (File > Open Data Folder)                                     |
//|  2. Refresh Navigator, drag onto any chart                        |
//|  3. Set the symbol/timeframe/years, run                           |
//|  4. Output lands in  MQL5/Files/<name>.csv                        |
//|                                                                  |
//| IMPORTANT — load the history first, or you will export a stub:    |
//|  open the symbol chart, set the timeframe, then hold Home until   |
//|  the chart stops loading older bars. MT5 only exports what the    |
//|  terminal has actually downloaded.                                |
//|                                                                  |
//| TIMEZONE: timestamps are BROKER SERVER time, not UTC. The script  |
//| prints the detected offset — pass it to the loader as             |
//| BACKTEST_CSV_TZ_OFFSET_MINS or session logic lands on the wrong   |
//| hour while still producing plausible-looking results.             |
//+------------------------------------------------------------------+
#property script_show_inputs
#property strict

input string           InpSymbol    = "XAUUSD";        // Symbol (blank = current chart)
input ENUM_TIMEFRAMES  InpTimeframe = PERIOD_M15;      // Timeframe to export
input int              InpYears     = 5;               // Years of history to request
input string           InpFileName  = "";              // Output name (blank = auto)

//+------------------------------------------------------------------+
string TfName(ENUM_TIMEFRAMES tf)
{
   switch(tf)
   {
      case PERIOD_M1:  return("M1");
      case PERIOD_M5:  return("M5");
      case PERIOD_M15: return("M15");
      case PERIOD_M30: return("M30");
      case PERIOD_H1:  return("H1");
      case PERIOD_H4:  return("H4");
      case PERIOD_D1:  return("D1");
      default:         return(EnumToString(tf));
   }
}

void OnStart()
{
   string symbol = (StringLen(InpSymbol) > 0) ? InpSymbol : _Symbol;

   if(!SymbolSelect(symbol, true))
   {
      Print("ERROR: symbol ", symbol, " is not available. Check Market Watch.");
      return;
   }

   // Broker server time vs UTC. TimeGMTOffset() is the LOCAL offset, so derive the
   // server offset from the difference between server time and GMT.
   datetime srv = TimeCurrent();
   datetime gmt = TimeGMT();
   int offsetMins = (int)((srv - gmt) / 60);
   // Round to the nearest 15 min to absorb small clock drift.
   offsetMins = (int)(MathRound(offsetMins / 15.0) * 15);

   datetime from = TimeCurrent() - (datetime)(InpYears * 365 * 24 * 60 * 60);

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(symbol, InpTimeframe, from, TimeCurrent(), rates);

   if(copied <= 0)
   {
      Print("ERROR: CopyRates returned ", copied, ". Open the ", symbol, " ",
            TfName(InpTimeframe), " chart and hold Home until history finishes loading, then retry.");
      return;
   }

   string fname = InpFileName;
   if(StringLen(fname) == 0)
      fname = symbol + "_" + TfName(InpTimeframe) + ".csv";

   int h = FileOpen(fname, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(h == INVALID_HANDLE)
   {
      Print("ERROR: could not open ", fname, " for writing (", GetLastError(), ")");
      return;
   }

   FileWrite(h, "date", "time", "open", "high", "low", "close", "volume");

   int written = 0;
   for(int i = 0; i < copied; i++)
   {
      // Skip malformed bars rather than exporting them: a zero/!inverted bar silently
      // corrupts every indicator downstream.
      if(rates[i].high < rates[i].low || rates[i].open <= 0 || rates[i].close <= 0)
         continue;

      FileWrite(h,
         TimeToString(rates[i].time, TIME_DATE),
         TimeToString(rates[i].time, TIME_MINUTES),
         DoubleToString(rates[i].open,  _Digits),
         DoubleToString(rates[i].high,  _Digits),
         DoubleToString(rates[i].low,   _Digits),
         DoubleToString(rates[i].close, _Digits),
         (long)rates[i].tick_volume);
      written++;
   }

   FileClose(h);

   double days = (double)(rates[copied - 1].time - rates[0].time) / 86400.0;

   Print("=====================================================");
   Print("Exported ", written, " bars of ", symbol, " ", TfName(InpTimeframe));
   Print("  file   : MQL5/Files/", fname);
   Print("  from   : ", TimeToString(rates[0].time, TIME_DATE | TIME_MINUTES));
   Print("  to     : ", TimeToString(rates[copied - 1].time, TIME_DATE | TIME_MINUTES));
   Print("  span   : ", DoubleToString(days / 365.0, 2), " years (", (int)days, " days)");
   Print("  contract size: ", SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE), " oz per lot");
   Print("  min lot: ", SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN));
   Print("-----------------------------------------------------");
   Print("  SERVER TIMEZONE OFFSET: ", offsetMins, " minutes (UTC", (offsetMins >= 0 ? "+" : ""),
         DoubleToString(offsetMins / 60.0, 1), ")");
   Print("  Run the backtest with:  BACKTEST_CSV_TZ_OFFSET_MINS=", offsetMins);
   Print("=====================================================");
}
//+------------------------------------------------------------------+
